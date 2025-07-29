import { fork } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import chalk from 'chalk';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CITIES = [
    'punjab_g2003006',
    'islamabad-capital-territory_g2003003',
    'khyber-pakhtunkhwa_g2003005',
];

const MIN_DELAY_MS = 5000;
const MAX_DELAY_MS = 8000;
const STATE_FILE_PATH = path.join(__dirname, 'state.json');
const MAX_RETRIES = 5; // Maximum retries for each page

const randomDelay = () =>
    new Promise((resolve) => setTimeout(resolve, MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS)));

const getMemoryUsage = () => {
    const used = process.memoryUsage();
    return {
        rss: `${(used.rss / 1024 / 1024).toFixed(2)} MB`,
        heapUsed: `${(used.heapUsed / 1024 / 1024).toFixed(2)} MB`,
        heapTotal: `${(used.heapTotal / 1024 / 1024).toFixed(2)} MB`,
    };
};

const constructUrl = (city, bodyType, page) => {
    return `https://www.olx.com.pk/${city}/vehicles_c5?page=${page}&sorting=desc-creation&filter=body_type_eq_${bodyType}`;
};

const loadState = () => {
    try {
        if (fs.existsSync(STATE_FILE_PATH)) {
            const data = fs.readFileSync(STATE_FILE_PATH, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error(chalk.red(`Failed to load state: ${error.message}`));
    }
    return null;
};

const saveState = (state) => {
    try {
        fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(state, null, 2));
        console.log(chalk.blue(`State saved successfully!`));
    } catch (error) {
        console.error(chalk.red(`Failed to save state: ${error.message}`));
    }
};

process.on('SIGINT', () => {
    console.log(chalk.yellow('\nProcess interrupted. Saving state...'));
    saveState({ cityIndex, bodyType: currentBodyType, page: currentPage });
    process.exit();
});

let cityIndex = 0;
let currentBodyType = 1;
let currentPage = 1;

// Retry logic for scraping a page until content is loaded or max retries reached
const scrapePageWithRetries = async (url) => {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        console.log(chalk.yellow(`Crawling URL [Attempt ${attempt}]: ${url}`));
        const child = fork(path.join(__dirname, 'child.js'), [url]);

        try {
            await new Promise((resolve, reject) => {
                child.on('message', (message) => {
                    if (message && message.success) {
                        resolve();
                    } else {
                        reject(new Error(`Child process failed for ${url}`));
                    }
                });

                child.on('exit', (code) => {
                    if (code !== 0) {
                        console.error(chalk.red(`Child process failed with code ${code}.`));
                        reject(new Error(`Child process failed with code ${code}`));
                    }
                });
            });
            // Success, break out of retry loop
            return true;
        } catch (error) {
            console.error(chalk.red(`Error: ${error.message}`));
            if (attempt === MAX_RETRIES) {
                console.error(chalk.red(`Max retries reached for ${url}. Moving on...`));
                return false;
            }
            // Wait a bit before refreshing/trying again
            await randomDelay();
        }
    }
    return false;
};

const scrapeParentPages = async () => {
    const lastState = loadState();

    if (lastState) {
        cityIndex = lastState.cityIndex;
        currentBodyType = lastState.bodyType;
        currentPage = lastState.page;
        console.log(chalk.yellow(`Resuming from city: ${CITIES[cityIndex]}, body type: ${currentBodyType}, page: ${currentPage}`));
    }

    for (; cityIndex < CITIES.length; cityIndex++) {
        const city = CITIES[cityIndex];
        console.log(chalk.green(`Starting to scrape city: ${city}`));

        for (; currentBodyType <= 11; currentBodyType++) {
            console.log(chalk.cyan(`Scraping body type: ${currentBodyType} for city: ${city}`));

            for (; currentPage <= 3; currentPage++) {
                const url = constructUrl(city, currentBodyType, currentPage);

                const success = await scrapePageWithRetries(url);
                if (!success) {
                    // Save state and continue to next page
                    saveState({ cityIndex, bodyType: currentBodyType, page: currentPage });
                    continue;
                }

                // Save state after each URL is crawled
                saveState({ cityIndex, bodyType: currentBodyType, page: currentPage });

                const memoryUsage = getMemoryUsage();
                console.log(chalk.blue(`Memory Usage - RSS: ${memoryUsage.rss}, Heap Used: ${memoryUsage.heapUsed}, Heap Total: ${memoryUsage.heapTotal}`));
                await randomDelay();
            }
            currentPage = 1;
        }
        currentBodyType = 1;
    }

    console.log(chalk.green('All cities and body types crawled.'));
    console.log(chalk.yellow('Clearing state file...'));
    fs.writeFileSync(STATE_FILE_PATH, JSON.stringify({ cityIndex: 0, bodyType: 1, page: 1 }, null, 2));
};

scrapeParentPages().catch((err) => {
    console.error(chalk.red(`Scraping process terminated: ${err.message}`));
    saveState({ cityIndex, bodyType: currentBodyType, page: currentPage });
});
