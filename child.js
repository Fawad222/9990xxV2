import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { scrapeListing } from './text.js';
import axios from 'axios';

puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = path.resolve(__dirname, 'data');
const FToken = process.env.FILE_TOKEN;
const ProfileRepo = process.env.PROFILE_REPO;
const BASE_URL = process.env.PATH;

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

const files = {
    cars: path.join(OUTPUT_DIR, 'data.csv'),
};

const GITHUB_CONFIG = {
    token: FToken, // Replace with your GitHub PAT
    repo: ProfileRepo,   // Replace with your GitHub username/repo
    branch: "main",                    // Branch to push changes
    filePath: "data/data.csv",         // Path in the repository
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

        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.goto(parentUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector("#body-wrapper", { timeout: 30000 });

        await page.evaluate(() => window.scrollBy(0, window.innerHeight));
        await page.waitForSelector("#body-wrapper li.undefined article > div:last-child > a", { timeout: 30000 });

        const content = await page.content();
        const $ = cheerio.load(content);

        const listings = [];
        $("#body-wrapper li.undefined article > div:last-child > a").each((_, el) => {
            const relativeLink = $(el).attr("href");
            if (relativeLink && !visitedUrls.has(relativeLink)) {
                const fullLink = relativeLink.startsWith('http') ? relativeLink : `${BASE_URL}${relativeLink}`;
                visitedUrls.add(fullLink);
                listings.push(fullLink);
            }
        });

        console.log(chalk.yellow(`Found ${listings.length} child pages on ${parentUrl}`));

        const scrapedData = (await Promise.all(listings.map(scrapeListing))).filter(Boolean);
        saveToCSV(scrapedData, files.cars);

        await browser.close();

        // Upload updated CSV to GitHub
        await uploadToGitHub(files.cars, GITHUB_CONFIG);

        const endTime = Date.now();
        const responseTime = endTime - startTime;

        console.log(chalk.green(`Response Time: ${responseTime}ms`));

        // Send a success message back to the parent process
        process.send({ success: true });
    } catch (error) {
        console.error(chalk.red(`Error scraping parent page ${parentUrl}: ${error.message}`));
        process.send({ success: false, message: error.message });
    }
};

const parentUrl = process.argv[2];
scrapeChildPages(parentUrl).then(() => {
    console.log(chalk.green("Scraping completed for:", parentUrl));
});
