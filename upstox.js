const axios = require("axios");
const fs = require("fs");

const ACCESS_TOKEN = "eyJ0eXAiOiJKV1QiLCJrZXlfaWQiOiJza192MS4wIiwiYWxnIjoiSFMyNTYifQ.eyJzdWIiOiI0MzE2MDIiLCJqdGkiOiI2YTFiNmIyZTZlNzEyZjBlMWM2MmQ5YTQiLCJpc011bHRpQ2xpZW50IjpmYWxzZSwiaXNQbHVzUGxhbiI6ZmFsc2UsImlzRXh0ZW5kZWQiOnRydWUsImlhdCI6MTc4MDE4MTgwNiwiaXNzIjoidWRhcGktZ2F0ZXdheS1zZXJ2aWNlIiwiZXhwIjoxODExODAwODAwfQ.jMcOPWRJWWvUhYmtbwKfBVxoc2WnAhQDBNOHCdT_Tsk";

(async () => {
    try {
        const statuses = ['upcoming', 'open', 'closed', 'listed'];
        let allIpos = [];
        
        for (const status of statuses) {
            let page_number = 1;
            let total_pages = 1;
            
            while (page_number <= total_pages) {
                const response = await axios.get(
                    `https://api.upstox.com/v2/ipos?status=${status}&page_number=${page_number}`,
                    {
                        headers: {
                            Authorization: `Bearer ${ACCESS_TOKEN}`,
                            Accept: "application/json"
                        }
                    }
                );
                
                if (response.data && response.data.data) {
                    allIpos.push(...response.data.data);
                }
                
                if (response.data && response.data.meta_data && response.data.meta_data.page) {
                    total_pages = response.data.meta_data.page.total_pages;
                } else {
                    break;
                }
                page_number++;
            }
        }
        
        // Filter for 2026
        const ipos2026 = allIpos.filter(ipo => {
            const dateStr = ipo.bidding_start_date || ipo.bidding_end_date || ipo.listing_date;
            return dateStr && dateStr.includes('2026');
        });
        
        fs.writeFileSync('upstox_ipo.json', JSON.stringify(ipos2026, null, 2));
        console.log(`Saved ${ipos2026.length} IPOs from 2026 to upstox_ipo.json (fetched ${allIpos.length} total)`);
    } catch (e) {
        console.error("Error:", e.response ? e.response.data : e.message);
    }
})();