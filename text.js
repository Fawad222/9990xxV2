import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';
import chalk from 'chalk';

puppeteer.use(StealthPlugin());

export const scrapeListing = async (url) => {
    try {
        console.log(chalk.cyan(`Scraping URL: ${url}`));

        // Puppeteer: launch browser & load page
        const browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
            ],
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36');
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Get the full HTML after JS runs
        const html = await page.content();
        await browser.close();

        const $ = cheerio.load(html);

        // Try to find the correct <script> tag
        let scriptContent = null;
        $('script').each((i, el) => {
            const html = $(el).html();
            if (html && html.includes('window.__PRELOADED_STATE__')) {
                scriptContent = html;
            }
        });

        // Fallback: try last script tag
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

        // Return the extracted data
        return { title, carType, price, location, name, phoneNumber };
    } catch (error) {
        console.error(chalk.red(`Error scraping listing ${url}: ${error.message}`));
        return null;
    }
};
