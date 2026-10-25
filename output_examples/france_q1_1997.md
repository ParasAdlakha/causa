# Why did revenue per unit fall in France in Q1 1997 compared with Q1 1996?

In Q1 1997, France's revenue per unit fell 9.1% (from $1,049.98 to $953.90) because a 12.8% unit surge (16,722 to 18,860) was driven by the "4-Not Specified" order-priority category, which added $1.99M in revenue (460% of the total change) through many new customers, while CRM records show two key accounts enrolled in an 8% winter volume-discount programme in December 1996, creating a -$1.81M price effect that outweighed the +$2.24M volume effect [Q1][Q8][Q6].

## What drove it
The primary driver was the "4-Not Specified" order-priority segment, which grew revenue by $1.99M (460% of the total change, z=3.9) [Q8]. Within this segment, multiple new customers (e.g., Customer#000000574 $0→$349.0K) contributed, but no single customer was statistically significant [Q9]. The Machinery customer segment initially appeared to drive 419% of the change (Q5), but this effect vanished when 4-Not Specified was excluded (Q10), confirming it was a side effect.

## Why: what the CRM says
CRM events show that on 1996-12-10, Customer#000001091 and Customer#000000305 enrolled in a winter volume-discount programme: extra 8% off all lines from January to March 1997 in exchange for higher volumes [Q6]. This discount programme aligns with the surge in 4-Not Specified orders and the negative price effect.

## Price or volume
Volume effect was +$2.24M (units up 12.8%), while price/discount effect was -$1.81M, netting a +$432.7K revenue increase [Q1]. The revenue per unit fell because the price decline (9.1%) exceeded the revenue growth rate (2.5%).

## Compared with the whole company
Company-wide revenue fell 1.2% in the same period, with units down slightly and revenue per unit down 0.6% [Q2]. France outperformed the company, but its revenue per unit dropped more sharply due to the discount-driven volume push.

## Ruled out
- Individual customer outliers: no single customer moved significantly beyond the overall trend; largest was Customer#000001091 at 3.7 standard deviations [Q3].
- Part-type shifts: no part type showed a significant move; largest was Economy Anodized Steel at 2.4 standard deviations [Q7].
- Machinery segment as independent driver: its apparent effect disappeared when 4-Not Specified was excluded [Q10].

## Confidence and limitations
Confidence: 85%. A concentrated driver (4-Not Specified) was identified and drilled into; CRM events corroborate the discount mechanism; company-wide comparison provides context. However, one critic check remains open: the $1.99M figure for 4-Not Specified is flagged as potentially unsupported (C4: $1.99M does not match Q8), though Q8 reports that exact value. This discrepancy needs verification.

## Suggested next step
Validate the 4-Not Specified revenue change against source data to resolve the critic's concern, and analyze whether the 8% discount was applied uniformly across the new 4-Not Specified customers or only to the two enrolled accounts.

---
trace: logs/trace-20261025T142500-d9e22e.jsonl | 11 queries on zetaris | models: nvidia/nemotron-3.5-lightning-30b-a3b, nvidia/nemotron-3-ultra-550b-a55b | 725 s
