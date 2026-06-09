const { NSE, BSE } = require('nse-bse-api');

async function testNSE() {
  const nse = new NSE(__dirname);
  try {
    console.log('--- NSE Test ---');
    try {
      console.log('Calling equityMetaInfo for TCS...');
      const meta = await nse.equityMetaInfo('TCS');
      console.log('TCS Meta Info Result:', JSON.stringify(meta, null, 2));
    } catch (e) {
      console.log('equityMetaInfo failed:', e.message);
    }

    try {
      console.log('\nCalling quote for TCS...');
      const quoteData = await nse.quote({ symbol: 'TCS' });
      console.log('TCS Quote keys:', Object.keys(quoteData));
      console.log('TCS Quote metadata:', JSON.stringify(quoteData.metadata, null, 2));
      // Log some other interesting properties if any
      console.log('TCS Quote industry:', quoteData.industry || quoteData.sector || 'not found directly');
      console.log('TCS Quote info:', JSON.stringify(quoteData.info || {}, null, 2));
      console.log('TCS Quote priceInfo:', JSON.stringify(quoteData.priceInfo || {}, null, 2));
    } catch (e) {
      console.log('quote failed:', e.message);
    }
  } catch (err) {
    console.error('NSE Outer Error:', err);
  } finally {
    await nse.exit();
  }
}

async function testBSE() {
  const bse = new BSE({ downloadFolder: __dirname });
  try {
    console.log('\n--- BSE Test ---');
    const symbols = ['TCS', 'RELIANCE', 'INFY'];
    for (const sym of symbols) {
      try {
        console.log(`Getting scrip code for ${sym}...`);
        const code = await bse.getScripCode(sym);
        console.log(`${sym} code:`, code);
        if (code) {
          const sec = await bse.listSecurities({ scripcode: code });
          console.log(`${sym} Security info:`, JSON.stringify(sec[0] || {}, null, 2));
        }
      } catch (err) {
        console.log(`BSE Error for ${sym}:`, err.message);
      }
    }
  } catch (err) {
    console.error('BSE Outer Error:', err);
  }
}

async function run() {
  await testNSE();
  await testBSE();
}

run();
