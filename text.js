import axios from 'axios';
import * as cheerio from 'cheerio';
import chalk from 'chalk';

export const scrapeListing = async (url) => {
    try {
        // Fetch the page content
        const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(data);

        // Select the script tag containing the data
        const scriptContent = $("#body-wrapper + script").html();
        if (!scriptContent) {
            console.error(chalk.red("Script tag not found or empty."));
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
