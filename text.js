import axios from 'axios';
import axiosRetry from 'axios-retry';
import * as cheerio from 'cheerio';
import chalk from 'chalk';

const BASE_URL = 'https://www.olx.com.pk';

// A realistic desktop UA — keep this in sync with a real recent Chrome version.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// If OLX starts requiring an authenticated session to read phone numbers, drop a
// fresh cookie string here via env var (grab it from your browser devtools like
// you just did). Set OLX_COOKIE as a repo secret in GitHub Actions.
const OLX_COOKIE = process.env.OLX_COOKIE || '';

// --- Dedicated axios instance for the contactInfo API, with automatic retry/backoff ---
const contactApiClient = axios.create({ timeout: 15000 });

axiosRetry(contactApiClient, {
    retries: 3,
    retryDelay: (retryCount) => axiosRetry.exponentialDelay(retryCount, undefined, 1000),
    retryCondition: (error) => {
        return (
            axiosRetry.isNetworkOrIdempotentRequestError(error) ||
            error.code === 'ECONNABORTED' ||
            (error.response && [429, 500, 502, 503, 504].includes(error.response.status))
        );
    },
    onRetry: (retryCount, error, requestConfig) => {
        console.log(chalk.yellow(`    ↻ Retry ${retryCount}/3 for ${requestConfig.url} — reason: ${error.message}`));
    },
});

/**
 * Extracts the OLX listing ID from a listing URL.
 * Handles plain numeric ids (…-iid-1116556229) as well as the
 * accessory/parts id format (…-iid-ev534058-1).
 */
const extractListingId = (url) => {
    const match = url.match(/-iid-([a-zA-Z0-9-]+)\/?$/);
    return match ? match[1] : null;
};

/**
 * Calls OLX's contactInfo API to get the seller's phone number + name.
 * Never throws — always resolves to { phoneNumber, name }, defaulting to "N/A"
 * on any failure, and logs *why* it failed so issues are diagnosable from CI logs.
 */
const fetchContactInfo = async (listingId, refererUrl) => {
    const apiUrl = `${BASE_URL}/api/listing/${listingId}/contactInfo/`;

    const headers = {
        Accept: 'application/json',
        'Accept-Language': 'en',
        'User-Agent': UA,
        Referer: refererUrl,
        'X-Requested-With': 'XMLHttpRequest',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
    };

    if (OLX_COOKIE) headers['Cookie'] = OLX_COOKIE;

    try {
        const { data, status } = await contactApiClient.get(apiUrl, { headers });

        if (!data) {
            console.warn(chalk.yellow(`    ⚠ contactInfo API returned an empty body for listing ${listingId} (status ${status}).`));
            return { phoneNumber: 'N/A', name: 'N/A' };
        }

        const mobile =
            data.mobile ||
            (Array.isArray(data.mobileNumbers) && data.mobileNumbers.length > 0 ? data.mobileNumbers[0] : null) ||
            data.proxyMobile ||
            'N/A';

        const name = data.name ? data.name.trim() : 'N/A';

        if (mobile === 'N/A') {
            console.log(chalk.gray(`    – No phone number in contactInfo response for listing ${listingId} (seller has not shared a number). Skipping this listing.`));
        } else {
            console.log(chalk.green(`    ✓ contactInfo OK for listing ${listingId}: ${mobile}`));
        }

        return { phoneNumber: mobile, name };
    } catch (error) {
        const status = error.response ? error.response.status : 'NO_RESPONSE';
        const bodySnippet = error.response ? JSON.stringify(error.response.data).slice(0, 200) : error.message;

        if (status === 401 || status === 403) {
            console.error(chalk.red(`    ✗ contactInfo API auth error (${status}) for listing ${listingId}. OLX may now require a logged-in session for this endpoint — set OLX_COOKIE (env var / GH secret) to a fresh cookie string from your browser devtools. Details: ${bodySnippet}`));
        } else if (status === 404) {
            console.error(chalk.red(`    ✗ contactInfo 404 for listing ${listingId} — listing likely expired or was removed.`));
        } else if (status === 429) {
            console.error(chalk.red(`    ✗ contactInfo rate-limited (429) for listing ${listingId} even after retries — request rate is too high, increase delay/lower concurrency.`));
        } else {
            console.error(chalk.red(`    ✗ contactInfo request failed for listing ${listingId} (status: ${status}): ${bodySnippet}`));
        }

        return { phoneNumber: 'N/A', name: 'N/A' };
    }
};

export const scrapeListing = async (url) => {
    try {
        console.log(chalk.cyan(`→ Scraping listing: ${url}`));

        // Fetch the page content
        const { data } = await axios.get(url, {
            headers: { 'User-Agent': UA },
            timeout: 20000,
        });
        const $ = cheerio.load(data);

        // Select the script tag containing the embedded page data
        const scriptContent = $("#body-wrapper + script").html();
        if (!scriptContent) {
            console.error(chalk.red(`  ✗ Script tag not found or empty for ${url} — page structure may have changed.`));
            return null;
        }

        // --- Title ---
        const titleMatch = scriptContent.match(/"title":"(.*?)"/);
        const title = titleMatch ? titleMatch[1] : "N/A";

        // --- Price ---
        const priceMatch = scriptContent.match(/"formattedValue":"(\d{1,3}(,\d{3})+)"/);
        let price = priceMatch ? priceMatch[1] : "N/A";
        price = price.replace(/,/g, "");

        // --- Location ---
        const locationMatch = scriptContent.match(/"location\.lvl2":.*?"name":"(.*?)"/);
        const location = locationMatch ? locationMatch[1] : "N/A";

        // --- Car type (Body Type) via DOM ---
        const detailsSection = $('[aria-label="Details"] > div.undefined');
        let carType = "N/A";
        detailsSection.find('div').each((index, div) => {
            const bodyTypeLabel = $(div).find('span').first().text().trim();
            if (bodyTypeLabel === 'Body Type') {
                const nextSpan = $(div).find('span').eq(1).text().trim();
                carType = nextSpan || "N/A";
            }
        });

        // --- Phone number + name: now behind the contactInfo API ---
        const listingId = extractListingId(url);
        let phoneNumber = "N/A";
        let name = "N/A";

        if (!listingId) {
            console.error(chalk.red(`  ✗ Could not extract listing ID from URL: ${url} — skipping contactInfo lookup.`));
        } else {
            const contact = await fetchContactInfo(listingId, url);
            phoneNumber = contact.phoneNumber;
            name = contact.name;
        }

        // Fallback: try the old inline-script pattern in case OLX ever reverts,
        // or in case some listing types still embed it.
        if (phoneNumber === "N/A") {
            const phoneNumberMatch = scriptContent.match(/"phoneNumber":"(\+?92\d{9,10})"/);
            if (phoneNumberMatch) {
                phoneNumber = phoneNumberMatch[1];
                console.log(chalk.blue(`  ℹ Recovered phone number from inline page script for ${url} (API path returned nothing).`));
            }
        }
        if (name === "N/A") {
            const nameMatch = scriptContent.match(/"contactInfo":.*?"name":"(.*?)"/);
            if (nameMatch) name = nameMatch[1];
        }

        // Skip entries with no phone number (keeps prior behavior/output shape)
        if (phoneNumber === "N/A") {
            console.log(chalk.gray(`  – Skipping ${url}: no phone number available from any source.`));
            return null;
        }

        console.log(chalk.green(`  ✓ Scraped OK: "${title}" | Rs.${price} | ${location} | ${carType} | ${phoneNumber}`));

        return { title, carType, price, location, name, phoneNumber };
    } catch (error) {
        console.error(chalk.red(`  ✗ Error scraping listing ${url}: ${error.message}`));
        return null;
    }
};
