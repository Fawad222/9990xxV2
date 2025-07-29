import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import axios from 'axios';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { scrapeListing } from './text.js';

puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = path.resolve(__dirname, 'data');
const FToken = process.env.FILE_TOKEN;
const BASE_URL = 'https://www.olx.com.pk';

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

const files = {
    cars: path.join(OUTPUT_DIR, 'data.csv'),
};

const GITHUB_CONFIG = {
    token: FToken,
    repo: 'fawad-ali/olx',
    branch: "main",
    filePath: "data/data.csv",
};

const visitedUrls = new Set();

const saveToCSV = (data, filePath) => {
    if (data.length === 0) return;

    try {
        const headers = Object.keys(data[0]).join(',') + '\n';
        const csvData = data.map((row) => Object.values(row).join(',')).join('\n');

        const fileExists = fs.existsSync(filePath);
        if (!fileExists) {
            fs.writeFileSync(filePath, headers + csvData + '\n');
        } else {
            fs.appendFileSync(filePath, csvData + '\n');
        }

        console.log(chalk.white(`Data saved to ${filePath}`));
    } catch (error) {
        console.error(chalk.red(`Error saving data: ${error.message}`));
    }
};

const uploadToGitHub = async (localFilePath, githubConfig) => {
    try {
        const { token, repo, branch, filePath } = githubConfig;

        const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;
        const headers = { Authorization: `token ${token}` };

        let existingContent = '';
        let sha;

        // Check if the file exists in the repo and fetch its content
        try {
            const response = await axios.get(url, { headers });
            existingContent = Buffer.from(response.data.content, 'base64').toString('utf-8');
            sha = response.data.sha;
        } catch (err) {
            if (err.response.status !== 404) {
                throw new Error(`Failed to retrieve existing file: ${err.message}`);
            }
        }

        // Append the new content
        const newContent = fs.readFileSync(localFilePath, 'utf-8');
        const updatedContent = existingContent + newContent;

        // Encode the updated content and prepare payload
        const encodedContent = Buffer.from(updatedContent).toString('base64');
        const payload = {
            message: "Appended new data to CSV file",
            content: encodedContent,
            branch,
        };
        if (sha) payload.sha = sha;

        // Push the updated file to GitHub
        const response = await axios.put(url, payload, { headers });
        console.log(chalk.green(`CSV file updated on GitHub: ${response.data.content.html_url}`));
    } catch (error) {
        console.error(chalk.red(`Failed to update CSV on GitHub: ${error.message}`));
    }
};

const scrapeChildPages = async (parentUrl) => {
    const startTime = Date.now();
    try {
        const browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
            ],
        });
        const page = await browser.newPage();
        await page.goto(parentUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // Get all child URLs from the parent page
        // NOTE: Update selector below to match OLX's child listing links!
        const childUrls = await page.evaluate(() => {
            // Example selector: 'a[data-testid="listing-ad-link"]'
            // Replace with the correct selector for OLX child pages!
            return Array.from(document.querySelectorAll('a[data-testid="listing-ad-link"]')).map(a => a.href);
        });

        console.log(`Found ${childUrls.length} child pages on ${parentUrl}`);

        // Log each child URL for debugging
        childUrls.forEach((url, idx) => {
            console.log(`[Child ${idx + 1}] ${url}`);
        });

        // Scrape each child URL
        for (const childUrl of childUrls) {
            console.log(`Navigating to child URL: ${childUrl}`); // << Console for each child URL
            if (visitedUrls.has(childUrl)) {
                console.log(`Already visited: ${childUrl}`);
                continue;
            }
            visitedUrls.add(childUrl);

            try {
                // Refresh/load the child page before scraping
                await page.goto(childUrl, { waitUntil: 'networkidle2', timeout: 60000 });
                // Optionally, you can refresh again:
                // await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });

                // Now scrape the child page
                const pageContent = await page.content();

                // Example: use scrapeListing to parse content (customize as necessary)
                const scrapedData = scrapeListing(pageContent, childUrl);

                // Save scraped data if available
                if (scrapedData && scrapedData.length > 0) {
                    saveToCSV(scrapedData, files.cars);
                } else {
                    console.log(chalk.yellow(`No data scraped from ${childUrl}`));
                }
            } catch (childErr) {
                console.error(chalk.red(`Error scraping child URL ${childUrl}: ${childErr.message}`));
            }
        }

        await browser.close();

        // Optionally upload after all scraping
        await uploadToGitHub(files.cars, GITHUB_CONFIG);

        process.send && process.send({ success: true });
    } catch (error) {
        console.error(`Error scraping child pages: ${error.message}`);
        process.send && process.send({ success: false });
    }
};

// Entry point: get parent URL from process args and run scraper
const parentUrl = process.argv[2];
if (parentUrl) {
    scrapeChildPages(parentUrl);
} else {
    console.error("No parent URL provided to child.js");
    process.send && process.send({ success: false });
}
