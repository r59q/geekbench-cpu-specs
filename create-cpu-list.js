// Fetches Geekbench CPU data, enriches it with thread counts and boost frequencies, and exports the results to JSON.
async function fetchCpuData(delayMs = 1400) {
    const processorList = (await (await fetch("https://browser.geekbench.com/processor-benchmarks.json")).json()).devices
    console.log(`Fetched${processorList.length} processors. Fetching threads for each processor...`);
    console.log("Estimated time: " + (processorList.length * delayMs / 1000 / 60).toFixed(2) + " minutes");
    const processorListWithThreads =[]
    for (let i = 0; i < processorList.length; i++) {
        const {description, ...processor} = processorList[i];
        processor.name = processor.name.trim()
        if (processor.name === "AMD Ryzen Threadripper PRO 9985WX s") {
            // There's a typo in the original dataset
            processor.name = "AMD Ryzen Threadripper PRO 9985WX"
        }
        const coreCount = description.match(/\((\d+) cores?\)/);
        const frequency = parseFrequencyGHz(description);
        const detailsUrls = buildProcessorDetailsUrls(processor.name);
        console.log(`fetching threads and boost frequency for ${processor.name} at ${detailsUrls[0]}`);
        let processorSpecs;
        let originalError;
        for (let urlIndex = 0; urlIndex < detailsUrls.length; urlIndex++) {
            const candidateUrl = detailsUrls[urlIndex];
            if (urlIndex > 0) {
                console.log(`Retrying ${processor.name} at ${candidateUrl}`);
            }
            try {
                processorSpecs = await fetchProcessorSpecsFromDetailsUrl(candidateUrl, frequency);
                break;
            } catch (error) {
                if (!originalError) {
                    originalError = error;
                }
            }
        }
        if (!processorSpecs) {
            throw originalError;
        }
        const { threads, boostFrequency } = processorSpecs;
        console.log(`Processed ${i + 1}/${processorList.length}: ${processor.name} - ${threads} threads. Estimated time remaining: ${(((processorList.length - i - 1) * delayMs / 1000) / 60).toFixed(2)} minutes`);

        // sleep between requests to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, delayMs));
        processorListWithThreads.push({
            ...processor,
            frequency,
            boost_frequency: boostFrequency,
            cores: parseInt(coreCount[1], 10),
            threads
        });
    }
    // Export CPU list to JSON after scraping completes
    await exportCpuListToJson(processorListWithThreads, 'cpu-list.json');
}

function buildProcessorDetailsUrls(name) {
    const urls = [
        buildProcessorDetailsUrl(name),
        buildProcessorDetailsUrl(name, { singularizeTrailingS: true }),
        buildProcessorDetailsUrl(name, { withRadeonGraphics: true }),
        buildProcessorDetailsUrl(name, { withRadeonGraphics: true, singularizeTrailingS: true })
    ];
    return [...new Set(urls)];
}

function buildProcessorDetailsUrl(name, { withRadeonGraphics = false, singularizeTrailingS = false } = {}) {
    let slug = name
        .replace(/\+/g, '')
        .replace(/\//g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .toLowerCase();
    if (withRadeonGraphics && !slug.endsWith('-with-radeon-graphics')) {
        slug += '-with-radeon-graphics';
    }
    if (singularizeTrailingS && slug.endsWith('-s')) {
        slug = slug.slice(0, -2);
    }
    return `https://browser.geekbench.com/processors/${slug}`;
}

async function fetchProcessorSpecsFromDetailsUrl(detailsUrl, baseFrequency) {
    const scrape = await fetch(detailsUrl);
    const scrapedHTML = await scrape.text();
    return {
        threads: extractThreadsFromHtml(scrapedHTML),
        boostFrequency: extractBoostFrequencyFromHtml(scrapedHTML, baseFrequency)
    };
}

function parseFrequencyGHz(description) {
    // Might be both in GHz or MHz, handles both cases, converts MHz to GHz if needed
    const frequencyMatch = description.match(/([\d.]+)\s*([GM])Hz/i);
    if (!frequencyMatch) {
        throw new Error(`Frequency not found in description: ${description}`);
    }
    const value = parseFloat(frequencyMatch[1]);
    const unit = frequencyMatch[2].toUpperCase();
    return unit === 'M' ? value / 1000 : value;
}

function parseFrequencyValueToGHz(value) {
    return parseFrequencyGHz(value);
}

async function exportCpuListToJson(cpuList, filename = 'cpu-list.json') {
    const json = JSON.stringify(cpuList, null, 2);

    // Node.js environment: write file to disk
    try {
        const fs = require('fs').promises;
        await fs.writeFile(filename, json, 'utf8');
        console.log(`JSON written to ${filename}`);
    } catch (err) {
        console.error('Failed to write JSON file:', err);
        throw err;
    }

    return json;
}

function extractThreadsFromHtml(html) {
    const rawThreads = extractSystemValueFromHtml(html, 'Threads');
    if (rawThreads) {
        const num = /([0-9][0-9,]*)/.exec(rawThreads);
        return num ? parseInt(num[1].replace(/,/g, ''), 10) : null;
    }
    throw new Error("Threads not found in HTML" + html);
}

function extractBoostFrequencyFromHtml(html, baseFrequency) {
    const rawBoostFrequency = extractSystemValueFromHtml(html, 'Maximum Frequency');
    return rawBoostFrequency ? parseFrequencyValueToGHz(rawBoostFrequency) : baseFrequency;
}

function extractSystemValueFromHtml(html, label) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`<td[^>]*class=["']system-name["'][^>]*>\\s*${escapedLabel}\\s*<\\/td>\\s*<td[^>]*class=["']system-value["'][^>]*>\\s*([^<]+?)\\s*<\\/td>`, 'i');
    const match = pattern.exec(html);
    return match?.[1]?.trim() ?? null;
}

function parseDelayMsArg(argv) {
    const rawDelay = argv[2];
    if (rawDelay === undefined) {
        return 1400;
    }

    if (!/^\d+$/.test(rawDelay)) {
        throw new Error(`Invalid sleep delay: ${rawDelay}. Provide a non-negative integer in milliseconds.`);
    }

    return Number.parseInt(rawDelay, 10);
}

const delayMs = parseDelayMsArg(process.argv);
fetchCpuData(delayMs).catch(err => {
    console.error("Error fetching CPU data:", err);
    process.exitCode = 1;
});
