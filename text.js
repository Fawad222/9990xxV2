import axios from 'axios';
import * as cheerio from 'cheerio';
import chalk from 'chalk';

export const scrapeListing = async (url) => {
    try {
        console.log(chalk.cyan(`Scraping URL: ${url}`));

        // Fetch the page content with more retries and varying user-agents/cookies
        let data;
        let attempts = 0;
        const maxAttempts = 6;
        const userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ];
        while (attempts < maxAttempts) {
            try {
                const response = await axios.get(url, {
                    headers: {
                        'User-Agent': userAgents[attempts % userAgents.length],
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Referer': 'https://www.olx.com.pk/'
                    },
                    // Sometimes helps to send cookies as empty string
                    withCredentials: false
                });
                data = response.data;
                if (data && data.length > 0) break;
            } catch (fetchErr) {
                console.error(chalk.red(`Attempt ${attempts + 1} failed for ${url}: ${fetchErr.message}`));
            }
            attempts++;
            await new Promise(res => setTimeout(res, 1000 + attempts * 500));
        }

        if (!data || data.length === 0) {
            console.error(chalk.red(`Failed to fetch page content after ${maxAttempts} attempts for ${url}`));
            return null;
        }

        const $ = cheerio.load(data);

        // Try several selectors and logic for the script tag
        let scriptContent = $("#body-wrapper + script").html();

        // If not found, try all scripts containing window.__PRELOADED_STATE__ or window.__REDUX_STATE__, etc.
        if (!scriptContent) {
            $('script').each((i, el) => {
                const html = $(el).html();
                if (html && (
                    html.includes('window.__PRELOADED_STATE__') ||
                    html.includes('window.__REDUX_STATE__') ||
                    html.includes('"phoneNumber":') // fallback: contains phone
                )) {
                    scriptContent = html;
                }
            });
        }

        // Fallback: try scripts that contain "phoneNumber" or "contactInfo"
        if (!scriptContent) {
            $('script').each((i, el) => {
                const html = $(el).html();
                if (html && (html.includes('"phoneNumber":') || html.includes('"contactInfo":'))) {
                    scriptContent = html;
                }
            });
        }

        // Fallback: try last script tag
        if (!scriptContent) {
            scriptContent = $('script').last().html();
        }

        // Fallback: try any inline script tag
        if (!scriptContent) {
            $('script:not([src])').each((i, el) => {
                const html = $(el).html();
                if (html && (html.includes('phoneNumber') || html.includes('contactInfo'))) {
                    scriptContent = html;
                }
            });
        }

        if (!scriptContent) {
            console.error(chalk.red(`Script tag not found or empty for URL: ${url}`));
            return null;
        }

        // Extract the title
        const titleMatch = scriptContent.match(/"title":"(.*?)"/);
        const title = titleMatch ? titleMatch[1] : "N/A";

        // Extract the phone number
        const phoneNumberMatch = scriptContent.match(/"phoneNumber":"(\+?92\d{9,10})"/);
        const phoneNumber = phoneNumberMatch ? phoneNumberMatch[1] : "N/A";

        // Skip entries with no phone number
        if (phoneNumber === "N/A") {
            return null;
        }

        // Extract the name
        const nameMatch = scriptContent.match(/"contactInfo":.*?"name":"(.*?)"/);
        const name = nameMatch ? nameMatch[1] : "N/A";

        // Extract the price and remove commas
        const priceMatch = scriptContent.match(/"formattedValue":"(\d{1,3}(,\d{3})+)"/);
        let price = priceMatch ? priceMatch[1] : "N/A";
        price = price.replace(/,/g, "");

        // Extract the location
        const locationMatch = scriptContent.match(/"location\.lvl2":.*?"name":"(.*?)"/);
        const location = locationMatch ? locationMatch[1] : "N/A";

        // Extract the car type from the 'Details' section using Cheerio
        const detailsSection = $('[aria-label="Details"] > div.undefined');
        let carType = "N/A";
        detailsSection.find('div').each((index, div) => {
            const bodyTypeLabel = $(div).find('span').first().text().trim();
            if (bodyTypeLabel === 'Body Type') {
                const nextSpan = $(div).find('span').eq(1).text().trim();
                carType = nextSpan || "N/A";
            }
        });

        return { title, carType, price, location, name, phoneNumber };
    } catch (error) {
        console.error(chalk.red(`Error scraping listing ${url}: ${error.message}`));
        return null;
    }
};
