const { NSE } = require('nse-bse-api');

(async () => {
  const nse = new NSE(__dirname);

  // Define the date range for the year 2026
  const fromDate = new Date('2022-01-01');
  const toDate = new Date('2026-12-31');

  try {
    // Fetch past IPOs within this date range
    const pastIPOs = await nse.listPastIPO(fromDate, toDate);

    console.log(`Found ${pastIPOs.length} past IPOs in 2026.`);
    const fs = require('fs');
    fs.writeFileSync('ipo.json', JSON.stringify(pastIPOs, null, 2));
    console.log("Saved to ipo.json");
  } catch (error) {
    console.error("Error fetching past IPOs:", error.message);
  }
})();
