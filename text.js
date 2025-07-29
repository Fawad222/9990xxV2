import axios from 'axios';
import * as cheerio from 'cheerio';
import chalk from 'chalk';

export const scrapeListing = async (url) => {
    try {
        console.log(chalk.cyan(`Scraping URL: ${url}`));

        // Fetch the page content with retries to ensure full load
        let data;
        let attempts = 0;
        const maxAttempts = 3;
        while (attempts < maxAttempts) {
            try {
                const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                data = response.data;
                if (data && data.length > 0) break;
            } catch (fetchErr) {
                console.error(chalk.red(`Attempt ${attempts + 1} failed for ${url}: ${fetchErr.message}`));
            }
            attempts++;
            // Wait before retrying
            await new Promise(res => setTimeout(res, 2000));
        }

        if (!data || data.length === 0) {
            console.error(chalk.red(`Failed to fetch page content after ${maxAttempts} attempts for ${url}`));
            return null;
        }

        const $ = cheerio.load(data);

        // Wait until the script tag is present by checking multiple selectors and fallback
        let scriptContent = $("#body-wrapper + script").html();

        // If not found, try other likely script tags (useful if markup changes)
        if (!scriptContent) {
            // Try all script tags and see which one contains "window.__PRELOADED_STATE__"
            $('script').each((i, el) => {
                const html = $(el).html();
                if (html && html.includes('window.__PRELOADED_STATE__')) {
                    scriptContent = html;
                }
            });
        }

        // Additional fallback: try the very last script tag
        if (!scriptContent) {
            scriptContent = $('script').last().html();
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
            // console.log(chalk.yellow("Skipping entry with no phone number."));
            return null;
        }

        // Extract the name
        const nameMatch = scriptContent.match(/"contactInfo":.*?"name":"(.*?)"/);
        const name = nameMatch ? nameMatch[1] : "N/A";

        // Extract the price and remove commas
        const priceMatch = scriptContent.match(/"formattedValue":"(\d{1,3}(,\d{3})+)"/);
        let price = priceMatch ? priceMatch[1] : "N/A";
        price = price.replace(/,/g, ""); // Remove commas

        // Extract the location
        const locationMatch = scriptContent.match(/"location\.lvl2":.*?"name":"(.*?)"/);
        const location = locationMatch ? locationMatch[1] : "N/A";

        // Extract the car type from the 'Details' section using Cheerio
        const detailsSection = $('[aria-label="Details"] > div.undefined');
        let carType = "N/A"; // Default value

        // Find the div containing the "Body Type" and get the next span
        detailsSection.find('div').each((index, div) => {
            const bodyTypeLabel = $(div).find('span').first().text().trim();
            if (bodyTypeLabel === 'Body Type') {
                // Get the next sibling span (this will be the car type)
                const nextSpan = $(div).find('span').eq(1).text().trim();
                carType = nextSpan || "N/A"; // Use "N/A" if the next span is empty
            }
        });

        // Log extracted data for debugging
        // console.log({ title, carType, price, location, name, phoneNumber });

        // Return the extracted data
        return { title, carType, price, location, name, phoneNumber };
    } catch (error) {
        console.error(chalk.red(`Error scraping listing ${url}: ${error.message}`));
        return null;
    }
};
