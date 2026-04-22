import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import * as d3 from "d3";
import { BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine, ScatterChart, Scatter, ZAxis, LabelList } from "recharts";
import {
  getBars as getBarsRequest,
  getQuoteSnapshots as getQuoteSnapshotsRequest,
  getResearchEarningsCalendar as getResearchEarningsCalendarRequest,
  getResearchFundamentals as getResearchFundamentalsRequest,
  getResearchSecFilings as getResearchSecFilingsRequest,
  getResearchStatus as getResearchStatusRequest,
  getResearchTranscript as getResearchTranscriptRequest,
  getResearchTranscripts as getResearchTranscriptsRequest,
} from "@workspace/api-client-react";

/* ═══════════════════════════════════════════════════════════════════════════
   ╔══════════════════════════════════════════════════════════════════════╗
   ║                         DATA SECTION                                  ║
   ║  Everything from here until the next divider is pure data.           ║
   ║  Edit companies, edges, themes, and positions above the code line.   ║
   ╚══════════════════════════════════════════════════════════════════════╝
   ═══════════════════════════════════════════════════════════════════════════ */

/* ────── Visual/brand constants ────── */

const AI_VERTICALS = {
  photonics:   { n: "Photonics",       c: "#CDA24E", bg: "rgba(205,162,78,.07)", subs: ["Substrates","Lasers","Foundry","Assembly","DSP","CPO","Transport","Test"] },
  compute:     { n: "AI Compute",      c: "#5E94E8", bg: "rgba(94,148,232,.07)", subs: ["GPU","Custom ASIC","Foundry","IP","Packaging","Systems"] },
  memory:      { n: "HBM & Memory",    c: "#D86890", bg: "rgba(216,104,144,.07)", subs: ["HBM"] },
  power:       { n: "Power & Cooling", c: "#2a9a70", bg: "rgba(72,200,156,.07)", subs: ["Thermal","Power","Generation"] },
  networking:  { n: "Network Fabric",  c: "#A070E8", bg: "rgba(160,112,232,.07)", subs: ["Switching","Interconnect"] },
  dcInfra:     { n: "DC Infra",        c: "#50B8D8", bg: "rgba(80,184,216,.07)", subs: ["REIT","GPU Cloud","AI Hosting"] },
  hyperscaler: { n: "Hyperscalers",    c: "#E06848", bg: "rgba(224,104,72,.07)", subs: ["Cloud","AI Infra"] },
};

// Static stock prices snapshot — fallback when live quotes unavailable.
const SP = {AAOI:152.5,AEHR:82.69,ALMU:17.02,AMD:273.42,AMKR:62.78,AMZN:249.38,ANET:159.13,APH:147.75,APLD:29.88,ARM:161.96,AVGO:397.77,AXTI:78.87,CIEN:489.96,CLS:382.68,COHR:320.69,CORZ:19.14,CRDO:158.21,CRWV:118.08,CSCO:83.88,DELL:191.8,DLR:198.25,EQIX:1067.2,ETN:392.49,FN:668.23,FORM:127.47,GEV:974.95,GFS:49.88,GLW:164.07,GOOG:332.58,HIMX:11.16,INTC:67.92,IPGP:118.75,IRM:116.83,LITE:889.07,LPTH:14.02,LWLG:11.95,META:674.73,MRVL:133.81,MSFT:419.54,MTSI:262.65,MU:453.68,NOK:10.26,NVDA:198.21,ONTO:267.33,POET:7.25,POWL:230.53,SKYT:32.38,SMCI:28.47,TSM:362.5,VIAV:41.58,VRT:293.97,SKHYNIX:168,SAMSUNG:48,SOI:92,JNPR:40,FRMI:6.36,LASR:30,ALAB:137,
  // Defense (approximate, will be overwritten by live FMP fetch)
  LMT:465,NOC:592,RTX:128,GD:300,BA:170,HII:220,LHX:236,TXT:76,
  MRCY:44,CUB:100,HEI:232,TDG:1365,LDOS:148,BAH:137,CACI:411,SAIC:120,
  PLTR:89,AVAV:250,KTOS:52,RKLB:52,BWXT:108,
  // Nuclear
  CEG:285,VST:192,D:59,SO:95,NRG:119,OKLO:104,SMR:13,NNE:23,
  LEU:207,CCJ:69,URG:1.54,UEC:8.75,DNN:1.89,FLR:53,
  // Drones
  ONDS:3.10,RCAT:7.20,AIRO:17,UMAC:11,PDYN:13,ADI:245,
  // Space
  ASTS:42,IRDM:28,PL:6.20,SPIR:5.40,BKSY:3.60,MAXR:73,AJRD:62,ROK:287,
  // Robotics
  TSLA:320,SYM:35,KSCP:5.10,EMR:133,FANUY:13,ABBNY:48,ABB:48,ISRG:565,ZBRA:330,TER:125,
  // Quantum
  IONQ:34,RGTI:11,QBTS:6.60,QUBT:14,IBM:228,HON:220,
  // Biotech
  LLY:810,NVO:71,AMGN:287,VKTX:41,ALT:4.60,TERN:8.90,CTLT:56,LNZA:60,RGEN:160,BDX:224,WST:325,
  // Batteries
  PANW_BAT:60,LGEM:24,CATL:30,FLNC:19,STEM:.60,BE:34,NVEE:20,ALB:102,PLL:5,MP:25,ENPH:67,SEDG:17,FSLR:234,
  // Uranium
  NXE:9.60,UUUU:7,LAC:3.70,URA:34,SPUT:23,
  // Crypto
  MARA:17,RIOT:13,CLSK:10,HUT:20,BITF:1.80,COIN:275,HOOD:46,MSTR:475,SMLR:62,GLXY:19,
  // Pass 4
  ASML:780,AMAT:175,LRCX:85,KLAC:880,SNPS:620,CDNS:310,
  RNMBY:170,BAESY:22,FINMY:47,ESLT:445,"MOG.A":220,OSK:115,
  TLN:485,NEE:75,EXC:44,PEG:89,XEL:78,
  LUNR:20,RDW:17,FLY:40,VOYG:32,
  DPRO:4.20,UAVS:5.00,
  RR:3.50,SERV:17,XPEV:21,
  INFQ:10.50,ARQQ:7.50,XANM:7.80,
  PFE:28,RHHBY:36,AZN:148,ZEAL:23.50,GPCR:40,
  QS:10,SLDP:3.30,EOSE:6.20,FREY:2.20,
  USAR:8,NATKY:38,
  IREN:73,CIFR:30,WULF:11,BTDR:22,
  // eVTOL
  JOBY:13,ACHR:12,
  // Intl uranium
  KAP:52,PDN:7.50,BOE:2.80,
  // Defense / nuclear naval
  CW:462,
  // Post-quantum
  LAES:6.80,
  // Biotech
  ZLDPF:60,
};

// Branded ticker → (color, 2-letter initial) for node iconography.
const BRAND = {
  NVDA:["#76b900","NV"], AMD:["#ED1C24","AMD"], AVGO:["#cc092f","B"], INTC:["#0071C5","I"],
  TSM:["#c4001a","T"], ARM:["#0091bd","ARM"], MRVL:["#a6192e","M"], MTSI:["#003087","MA"],
  LITE:["#00599d","LU"], COHR:["#00205b","C"], AAOI:["#e37222","AO"], FN:["#004990","FN"],
  TSEM:["#ee3124","TW"], CIEN:["#702F8A","CI"], NOK:["#124191","NK"], CSCO:["#1BA0D7","C"],
  ANET:["#5b8c2a","AN"], JNPR:["#84bd00","J"], AEHR:["#00386a","AH"], FORM:["#e31937","FF"],
  AXTI:["#1a5276","AX"], IQE:["#2e86c1","IQ"], SOI:["#c0392b","SO"],
  SIVE:["#2980b9","SV"], POET:["#8e44ad","PT"], LWLG:["#27ae60","LW"], ALMU:["#2c3e50","AL"],
  SKHYNIX:["#e74c3c","SK"], MU:["#005eb8","MU"], SAMSUNG:["#034ea2","SS"],
  VRT:["#00843d","VT"], ETN:["#005f9e","ET"], POWL:["#0a3d62","PW"], GEV:["#3D7AB5","GE"],
  EQIX:["#ed1c24","EQ"], DLR:["#002d72","DL"], CRWV:["#ff6b00","CW"],
  AMZN:["#ff9900","AZ"], MSFT:["#00a4ef","MS"], GOOG:["#4285f4","G"], META:["#0081fb","M"],
  AMKR:["#003c71","AK"], DELL:["#007db8","DL"], SMCI:["#003399","SM"], CLS:["#0064a4","CL"],
  APH:["#6f2da8","AP"], GLW:["#003087","CG"], IRM:["#3d9b35","IM"],
  APLD:["#00b4d8","AD"], CORZ:["#f9a825","CZ"],
  CRDO:["#00a3e0","CR"], GFS:["#21b24b","GF"], IPGP:["#cc0000","IP"],
  ONTO:["#0a2240","ON"], VIAV:["#00a3e0","VI"], SKYT:["#2196f3","SW"],
  LPTH:["#1565c0","LP"], HIMX:["#0d47a1","HX"],
  FRMI:["#1a5276","FM"], LASR:["#e74c3c","nL"], ALAB:["#6c3483","AL"],
  // Defense
  LMT:["#0a3d62","LM"], NOC:["#003366","NG"], RTX:["#ef3340","RT"], GD:["#1c4587","GD"],
  BA:["#0039a6","B"], HII:["#1e5f74","HI"], LHX:["#000033","L3"], TXT:["#e31937","TX"],
  MRCY:["#003087","MR"], CUB:["#005f9e","CU"], HEI:["#1e3a8a","HE"], TDG:["#0f3460","TD"],
  LDOS:["#00457C","LD"], BAH:["#ce0e2d","BZ"], CACI:["#003057","CI"], SAIC:["#0072CE","SC"],
  PLTR:["#000000","PL"], AVAV:["#1e3a8a","AV"], KTOS:["#003B5C","KT"], RKLB:["#000","RL"],
  BWXT:["#003366","BW"],
  // Nuclear
  CEG:["#00816a","CE"], VST:["#005cbf","VS"], D:["#004b87","D"], SO:["#1a5490","SO"],
  NRG:["#005596","NR"], OKLO:["#8b5cf6","OK"], SMR:["#0ea5e9","NS"], NNE:["#06b6d4","NN"],
  LEU:["#dc2626","LE"], CCJ:["#c8102e","CC"], URG:["#1a5276","UR"], UEC:["#b45309","UE"],
  DNN:["#0f766e","DN"], FLR:["#0033a0","FL"],
  // Drones
  ONDS:["#2d5f3f","ON"], RCAT:["#c44040","RC"], AIRO:["#005596","AR"], UMAC:["#6c3483","UM"],
  PDYN:["#7c3aed","PD"], ADI:["#e31937","AD"],
  // Space
  ASTS:["#003c71","AS"], IRDM:["#e31937","IR"], PL:["#1a5276","PL"], SPIR:["#0f766e","SP"],
  BKSY:["#000","BK"], MAXR:["#003c71","MX"], AJRD:["#ef3340","AJ"], ROK:["#cc0000","RK"],
  // Robotics
  TSLA:["#c00","TS"], SYM:["#005596","SY"], KSCP:["#2a9a70","KS"], EMR:["#005596","EM"],
  FANUY:["#ffcd00","FA"], ABBNY:["#ff000f","AB"], ABB:["#ff000f","AB"], ISRG:["#00a9e0","IS"],
  ZBRA:["#0066b2","ZB"], TER:["#0062ba","TE"],
  // Quantum
  IONQ:["#6c3483","IO"], RGTI:["#8e44ad","RG"], QBTS:["#003c71","QB"], QUBT:["#7c3aed","QU"],
  IBM:["#0f62fe","IB"], HON:["#da291c","HN"],
  // Biotech
  LLY:["#d52b1e","LL"], NVO:["#003a70","NV"], AMGN:["#0063be","AM"], VKTX:["#1a8a5c","VK"],
  ALT:["#8e44ad","AL"], TERN:["#c44040","TR"], CTLT:["#f47720","CT"], LNZA:["#e30613","LN"],
  RGEN:["#5E94E8","RG"], BDX:["#00529b","BD"], WST:["#002d74","WS"],
  // Batteries
  PANW_BAT:["#a50034","LG"], LGEM:["#c00","LG"], CATL:["#ff8200","CA"], FLNC:["#0066b2","FL"],
  STEM:["#1a8a5c","ST"], BE:["#4a0063","BE"], NVEE:["#00529b","NV"], ALB:["#004c45","AL"],
  PLL:["#1a5276","PI"], MP:["#b8860b","MP"], ENPH:["#f47e24","EN"], SEDG:["#ed1c24","SE"],
  FSLR:["#0066b2","FS"],
  // Uranium
  NXE:["#0f766e","NX"], UUUU:["#b45309","UU"], LAC:["#005596","LA"], URA:["#1a5276","UA"],
  SPUT:["#a16207","SU"],
  // Crypto
  MARA:["#1a8a5c","MA"], RIOT:["#005596","RI"], CLSK:["#2a9a70","CL"], HUT:["#ff9c00","HU"],
  BITF:["#0066b2","BF"], COIN:["#0052ff","CO"], HOOD:["#00c805","HD"], MSTR:["#f4751f","MS"],
  SMLR:["#0066b2","SM"], GLXY:["#6c3483","GX"],
  // Pass 4 additions
  // AI · Semi equipment + EDA
  ASML:["#0077c8","AS"], AMAT:["#0066cc","AM"], LRCX:["#003366","LR"], KLAC:["#005cab","KL"],
  SNPS:["#00529b","SN"], CDNS:["#005baa","CD"],
  // Defense · European + Israeli
  RNMBY:["#1a1a1a","RH"], BAESY:["#003057","BA"], FINMY:["#003c71","LE"], ESLT:["#003366","EL"],
  "MOG.A":["#8b0000","MG"], OSK:["#ed1c24","OS"],
  // Nuclear · AI-DC utilities
  TLN:["#005cbf","TL"], NEE:["#0066b2","NE"], EXC:["#c8102e","EX"], PEG:["#003366","PS"], XEL:["#0077c8","XE"],
  // Space
  LUNR:["#000","LU"], RDW:["#dc2626","RD"], FLY:["#a855f7","FF"], VOYG:["#1a5276","VY"],
  // Drones
  DPRO:["#0f766e","DR"], UAVS:["#059669","UA"],
  // Robotics
  RR:["#dc2626","RR"], SERV:["#fbbf24","SV"], XPEV:["#00a8e1","XP"],
  // Quantum
  INFQ:["#8b5cf6","IN"], ARQQ:["#7c3aed","AQ"], XANM:["#4338ca","XN"],
  // Biotech
  PFE:["#0093D0","PF"], RHHBY:["#003A70","RO"], AZN:["#A4036F","AZ"], ZEAL:["#003a70","ZE"], GPCR:["#0891b2","GP"],
  // Batteries
  QS:["#c8102e","QS"], SLDP:["#000","SL"], EOSE:["#2a9a70","EO"], FREY:["#0066b2","FR"],
  // Uranium
  USAR:["#b45309","UR"], NATKY:["#4b2e83","KZ"],
  // Crypto · AI-pivot miners
  IREN:["#f97316","IE"], CIFR:["#0ea5e9","CF"], WULF:["#1e293b","WU"], BTDR:["#a16207","BD"],
  // eVTOL
  JOBY:["#059669","JB"], ACHR:["#1e40af","AC"],
  // Intl uranium
  KAP:["#00b0a8","KP"], PDN:["#dc2626","PN"], BOE:["#7c2d12","BO"],
  // Defense / naval nuclear
  CW:["#003366","CW"],
  // Post-quantum
  LAES:["#8b5cf6","LA"],
  // Biotech Zealand
  ZLDPF:["#c41e3a","ZL"],
};

/* ────── API symbol mappings ────── */
// Some tickers need remapping for FMP foreign-exchange lookups.
const FMP_SYM = {
  IQE: "IQE.L",        // London AIM (IQE plc)
  SOI: "SOI.PA",       // Euronext Paris (Soitec)
  SIVE: "SIVE.ST",     // Nasdaq Stockholm (Sivers)
  SKHYNIX: "000660.KS",// KRX Seoul (SK Hynix)
  SAMSUNG: "005930.KS",// KRX Seoul (Samsung Electronics)
};
const FMP_REVERSE = Object.fromEntries(Object.entries(FMP_SYM).map(([k, v]) => [v, k]));

/* ────── Universe: 276 companies across 11 themes ────── */
const COMPANIES = [
  { t:"AXTI", themes:["ai"], cc:"🇺🇸", nm:"AXT Inc", v:"photonics", s:"Substrates", r:100, g:25.7, mc:4338, pe:null, pr:"InP substrates", d:"Top-3 InP substrate supplier. China manufacturing via Tongmei subsidiary. Doubling InP capacity in 2026 to meet AI datacenter demand.", ri:["China export controls","36x revenue valuation"], ca:["InP capacity 2x in 2026","AI-driven InP supercycle"], dc:{f:-15,gr:40,w:12,tg:3,sh:55.6}, ms:{ta:.9,ch:.95,ai:.8,ra:.3}, fin:{beta:1.8,eps:-.38,div:0,rg:[-11,5,15,30,40]} },
  { t:"IQE", themes:["ai"], cc:"🇬🇧", nm:"IQE plc", v:"photonics", s:"Substrates", r:140, g:20, mc:400, pe:null, pr:"Epitaxial wafers", d:"World's only scaled independent epitaxial wafer foundry. 100+ MOCVD reactors. Financial distress \u2014 strategic review includes potential full sale.", ri:["Cash runway ~12 months","HSBC covenant waivers"], ca:["Acquisition premium potential","Newport InP mega-foundry"], dc:{f:-20,gr:50,w:15,tg:2,sh:950}, ms:{ta:.4,ch:.3,ai:.7,ra:.8}, fin:{beta:2.2,eps:-.04,div:0,rg:[-15,-8,5,20,35]} },
  { t:"SOI", themes:["ai"], cc:"🇫🇷", nm:"Soitec SA", v:"photonics", s:"Substrates", r:2800, g:33.5, mc:16560, pe:22, pr:"Photonics-SOI wafers", d:">95% global monopoly in Photonics-SOI via patented Smart Cut\u2122 technology. Sole qualified volume supplier at Tower Semiconductor, GlobalFoundries, and TSMC.", ri:["RF-SOI mobile cycle downturn","CEO transition"], ca:["Tower $920M expansion = direct wafer demand","Strongest monopoly in the stack"], dc:{f:180,gr:15,w:9,tg:3,sh:180.5}, ms:{ta:.5,ch:.2,ai:.85,ra:.4}, fin:{beta:1.4,eps:2.59,div:0,rg:[-2,8,12,15,18]} },
  { t:"LITE", themes:["ai"], cc:"🇺🇸", nm:"Lumentum Holdings", v:"photonics", s:"Lasers", r:2200, g:48.5, mc:59568, pe:44, pr:"200G EML laser chips", d:"Only supplier shipping 200G-per-lane EMLs at volume. NVIDIA made a $2B strategic investment with multi-billion-dollar procurement commitments. All EML capacity fully booked through 2027.", ri:["$3.3B debt load","Negative free cash flow"], ca:["NVIDIA $2B partnership","Sole-source 200G EML position","1.6T transceiver ramp"], dc:{f:-105,gr:80,w:11,tg:3,sh:67}, ms:{ta:.4,ch:.5,ai:.95,ra:.6}, fin:{beta:1.35,eps:-0.06,div:0,rg:[-20,-5,5,10,15]}, rs:[["Cloud & Networking (transceivers)",82],["Industrial Tech (lasers)",18]], geo:[["US",28],["China",35],["Other Asia",28],["Europe",9]], tc:[["Cisco",22],["Fabrinet (CM)",18],["Ciena",12],["Nokia",8],["Infinera (now Nokia)",7],["Hyperscalers direct",18],["Industrial",15]], pl:[{name:"800G DR8 / 2xFR4 transceivers",desc:"AI data center optical interconnect · Blackwell/Hopper cluster links",pos:"Flagship AI product"},{name:"1.6T transceivers",desc:"Next-gen · sampling · 2026 volume",pos:"Roadmap"},{name:"ROADMs / EDFAs",desc:"Long-haul + metro optical amplification",pos:"Franchise"},{name:"DCI (data center interconnect)",desc:"Coherent pluggables · ZR/ZR+",pos:"Growth"},{name:"Cloudlight (Cloud Light Technology acq)",desc:"EML silicon photonics for 1.6T",pos:"Silicon photonics"},{name:"Neo industrial lasers",desc:"EUV source laser subsystems · ASML tie-in",pos:"High-margin niche"}], cp:["COHR","AAOI","Fabrinet","Innolight","Accelink"], ops:{hq:"San Jose, CA",fd:2015,emp:6200,ne:"Mid May 2026"}, own:{insider:.3,institutional:97} },
  { t:"AAOI", themes:["ai"], cc:"🇺🇸", nm:"Applied Optoelectronics", v:"photonics", s:"Lasers", r:500, g:30.4, mc:4575, pe:80, pr:"1.6T LPO transceivers", d:"Vertically integrated transceiver maker, US-based manufacturing in Sugar Land, TX. Scaling from $456M to $1B+ revenue in CY2026. Began 1.6T LPO shipments March 2026.", ri:["Microsoft ~29% of revenue","Still unprofitable at scale"], ca:["$1B+ CY2026 revenue guidance","US manufacturing supply chain premium"], dc:{f:-25,gr:90,w:13,tg:3,sh:30}, ms:{ta:.3,ch:.2,ai:.95,ra:.5}, fin:{beta:2.5,eps:-1.01,div:0,rg:[-30,15,50,83,100]} },
  { t:"COHR", themes:["ai","quantum"], cc:"🇺🇸", nm:"Coherent Corp", v:"photonics", s:"Lasers", r:5810, g:37, mc:49707, pe:35, pr:"800G/1.6T transceivers", d:"Volume leader in optical transceivers with ~25% market share and the deepest vertical integration in the industry. NVIDIA Spectrum-X collaborator. Ramping 6-inch InP production.", ri:["300x trailing P/E due to acquisition costs"], ca:["$15B CPO serviceable addressable market","6-inch InP wafer ramp (4x yield improvement)"], dc:{f:130,gr:35,w:10,tg:3,sh:155}, ms:{ta:.5,ch:.4,ai:.9,ra:.5}, fin:{beta:1.7,eps:1.75,div:0,rg:[5,10,18,23,35]}, rs:[["Networking (transceivers + DCI)",52],["Lasers (industrial + defense)",26],["Materials (SiC + photonic chips)",22]], geo:[["North America",42],["China",22],["Other Asia",20],["Europe",16]], tc:[["Cisco",17],["Hyperscalers direct",22],["Semi cap equipment",12],["Defense/aerospace",10],["Industrial (Autos/consumer)",20],["Other",19]], pl:[{name:"800G / 1.6T transceivers",desc:"AI data center links · EML chips from captive II-VI heritage",pos:"Flagship AI product"},{name:"EML laser chips",desc:"Vertically integrated laser die supplier (merchant + captive)",pos:"Structural advantage"},{name:"SiC substrates (150mm/200mm)",desc:"Silicon Carbide substrates for EV/industrial",pos:"Asset-heavy diversifier"},{name:"Excimer lasers",desc:"LCD annealing · semi litho sources",pos:"Franchise"},{name:"Industrial cutting lasers",desc:"Fiber lasers for metal processing",pos:"Legacy II-VI biz"},{name:"Aerospace & Defense lasers",desc:"DEW · target designators · ISR optics",pos:"Niche premium"}], cp:["LITE","AAOI","Fabrinet","Wolfspeed (SiC)","nLight"], ops:{hq:"Saxonburg, PA",fd:1971,emp:26000,ne:"Mid May 2026"}, own:{insider:.2,institutional:98} },
  { t:"TSEM", themes:["ai"], cc:"🇮🇱", nm:"Tower Semiconductor", v:"photonics", s:"Foundry", r:1600, g:24, mc:6720, pe:20, pr:"SiPh wafer fabrication", d:"Primary specialty foundry for silicon photonics. $920M capex expansion delivers >5x current SiPh wafer capacity by December 2026. Over 70% of new capacity already reserved through 2028.", ri:["60-103x P/E vs 19x historical average"], ca:["Becoming the 'TSMC of photonics'","$2.84B revenue / 31.7% OPM target by 2028"], dc:{f:-50,gr:60,w:10,tg:3,sh:112}, ms:{ta:.3,ch:.2,ai:.9,ra:.4}, fin:{beta:1.3,eps:1.99,div:0,rg:[8,12,15,20,30]} },
  { t:"FN", themes:["ai"], cc:"🇹🇭", nm:"Fabrinet", v:"photonics", s:"Assembly", r:3500, g:10.5, mc:24056, pe:35, pr:"Transceiver OSAT assembly", d:"Leading outsourced assembly and test for optical transceivers. Thailand operations. Zero debt with $934M cash. Building 10 opens in 2026 doubling 1.6T capacity.", ri:["NVIDIA 27.6% and Cisco 18.2% customer concentration"], ca:["Building 10 adds $2.4B annual production capacity","AWS strategic warrant arrangement"], dc:{f:380,gr:20,w:9.5,tg:3,sh:36}, ms:{ta:.7,ch:.2,ai:.9,ra:.3}, fin:{beta:1.2,eps:10.44,div:0,rg:[12,15,19,22,28]} },
  { t:"MRVL", themes:["ai"], cc:"🇺🇸", nm:"Marvell Technology", v:"photonics", s:"DSP", r:8200, g:52, mc:116410, pe:55, pr:"PAM4 DSP + custom XPU", d:"Industry leader in PAM4 DSPs for 800G/1.6T transceivers. 18+ XPU design wins with a $75B lifetime revenue funnel. Data center segment represents 74% of revenue.", ri:["Top 10 customers represent 81% of revenue"], ca:["PEG ratio of 0.62 (attractive growth-adjusted)","$75B lifetime revenue funnel"], dc:{f:2800,gr:25,w:10,tg:3,sh:870}, ms:{ta:.5,ch:.6,ai:.95,ra:.4}, fin:{beta:1.5,eps:2.94,div:.06,rg:[5,18,30,42,55]}, rs:[["Data Center (custom ASIC + DSP)",72],["Enterprise Networking",10],["Carrier",9],["Consumer",4],["Automotive/Industrial",5]], geo:[["US",40],["China",18],["Other Asia",30],["Europe",12]], tc:[["Amazon (Trainium ASIC)",22],["Microsoft (Maia ASIC)",13],["Google (subset)",5],["Meta",4],["Cisco/Juniper (optical DSP)",18],["Other networking",20],["Other",18]], pl:[{name:"Custom ASICs (Trainium 3, Maia 2)",desc:"Amazon · Microsoft · key hyperscaler wins",pos:"AI silicon flagship"},{name:"Nova / Perseus optical DSP",desc:"800G → 1.6T coherent + PAM4 DSP",pos:"Category leader"},{name:"Teralynx Ethernet switches",desc:"51.2T/102.4T · competitor to AVGO Tomahawk",pos:"Fabric play"},{name:"5nm SerDes IP",desc:"High-speed interconnect IP licensed",pos:"Foundational"},{name:"Alaska PHY",desc:"Automotive Ethernet (AEC, 10G)",pos:"Diversifier"},{name:"Storage controllers",desc:"HDD SoCs · declining",pos:"Legacy"}], cp:["AVGO","NVDA (Spectrum-X)","ALAB","CRDO","Alchip"], ops:{hq:"Santa Clara, CA",fd:1995,emp:7400,mfg:["Fabless · TSMC 5nm/3nm"],ne:"Late May 2026"}, own:{insider:.2,institutional:90} },
  { t:"MTSI", themes:["ai"], cc:"🇺🇸", nm:"MACOM Technology", v:"photonics", s:"DSP", r:820, g:60, mc:17861, pe:38, pr:"TIA + laser drivers", d:"Analog photonic IC specialist providing the TIAs and laser drivers inside every transceiver. Owns compound semiconductor fabs. 6,000+ diversified customers. PEG of 0.38.", ri:["Smaller scale versus Marvell and Broadcom"], ca:["Best growth-adjusted valuation in Layer 4","43% defense/industrial diversification"], dc:{f:200,gr:30,w:10.5,tg:3,sh:68.5}, ms:{ta:.4,ch:.3,ai:.8,ra:.4}, fin:{beta:1.4,eps:2.97,div:0,rg:[8,15,25,33,42]} },
  { t:"SIVE", themes:["ai"], cc:"🇸🇪", nm:"Sivers Semiconductors", v:"photonics", s:"CPO", r:30, g:15, mc:490, pe:null, pr:"InP external light source", d:"InP DFB laser arrays for co-packaged optics. Partnership with O-Net and Enablence for 8-channel external light sources. Cash dangerously thin at ~$4.4M.", ri:["Approximately 6 months of cash runway"], ca:["CPO partnership momentum with O-Net"], dc:{f:-18,gr:70,w:18,tg:2,sh:180}, ms:{ta:.3,ch:.2,ai:.85,ra:.6}, fin:{beta:2.8,eps:-.14,div:0,rg:[-20,10,30,45,60]} },
  { t:"POET", themes:["ai"], cc:"🇨🇦", nm:"POET Technologies", v:"photonics", s:"CPO", r:6, g:-50, mc:653, pe:null, pr:"Optical interposer", d:"Monolithic photonic integration platform. $430M cash provides 10+ years of runway. Plans to ship 30,000+ optical engines in 2026. Pure optionality play.", ri:["$1M revenue versus $959M market cap"], ca:["$430M cash cushion (10+ year runway)","CPO adoption acceleration"], dc:{f:-35,gr:100,w:20,tg:2,sh:90}, ms:{ta:.1,ch:.1,ai:.9,ra:.3}, fin:{beta:3.0,eps:-.20,div:0,rg:[-50,-20,50,150,200]} },
  { t:"LWLG", themes:["ai"], cc:"🇺🇸", nm:"Lightwave Logic", v:"photonics", s:"CPO", r:.24, g:-100, mc:1733, pe:null, pr:"Electro-optic polymer modulator", d:"Perkinamine\u00AE electro-optic polymer integrated into Tower Semiconductor PH18 and GlobalFoundries silicon photonics PDKs. Stock surged 15x. Revenue negligible.", ri:["$237K revenue versus $1.8B market cap"], ca:["Dual-foundry PDK integration validated"], dc:{f:-12,gr:2,w:22,tg:2,sh:145}, ms:{ta:.1,ch:.1,ai:.8,ra:.4}, fin:{beta:3.2,eps:-.10,div:0,rg:[-40,-10,80,120,200]} },
  { t:"ALMU", themes:["ai"], cc:"🇺🇸", nm:"Aeluma Inc", v:"photonics", s:"CPO", r:5.7, g:-80, mc:426, pe:null, pr:"III-V on silicon integration", d:"Grows III-V compound semiconductors directly onto silicon wafers. Revenue from NASA, Navy, DOE government R&D contracts. Pre-commercial stage.", ri:["Pre-commercial \u2014 years from production revenue"], ca:["$38.6M cash with 5+ year runway","$4M+ in new federal contracts"], dc:{f:-6,gr:80,w:20,tg:2,sh:25}, ms:{ta:.1,ch:.1,ai:.6,ra:.3}, fin:{beta:2.5,eps:-.32,div:0,rg:[-30,0,20,35,50]} },
  { t:"CIEN", themes:["ai","quantum"], cc:"🇺🇸", nm:"Ciena Corporation", v:"photonics", s:"Transport", r:4500, g:45, mc:73494, pe:45, pr:"WaveLogic 6 coherent engine", d:"Global leader in coherent optical transport. WaveLogic 6 delivers industry-first 1.6 Tbps single-wavelength using 3nm silicon. Over 1 year technology lead. $5B record backlog.", ri:["277x trailing P/E ratio"], ca:["WaveLogic 6 technology lead","FY2026 guidance $5.7-6.1B (+20-28%)"], dc:{f:665,gr:20,w:10,tg:3,sh:150}, ms:{ta:.4,ch:.3,ai:.85,ra:.4}, fin:{beta:1.1,eps:.74,div:0,rg:[3,8,15,19,25]}, rs:[["Networking Platforms (hardware)",78],["Platform Software",7],["Services",15]], geo:[["Americas",58],["EMEA",23],["APAC",19]], tc:[["Tier-1 telcos (AT&T/VZ/BT/TEF)",40],["Hyperscalers",30],["Cable operators",12],["Enterprise/federal",18]], pl:[{name:"WaveLogic 6 coherent DSP",desc:"1.6T long-haul · DCI links for AI",pos:"Coherent leader"},{name:"6500 packet-optical",desc:"Metro + long-haul · installed base",pos:"Franchise"},{name:"Blue Planet MCP",desc:"Network automation software",pos:"SDN"},{name:"Pluggable optics (WL6e)",desc:"QSFP-DD ZR+ pluggables",pos:"Hyperscale entry"}], cp:["NOK","Infinera (Nokia)","LITE","COHR (optics)"], ops:{hq:"Hanover, MD",fd:1992,emp:9400,ne:"Early Jun 2026"}, own:{insider:.2,institutional:92} },
  { t:"NOK", themes:["ai"], cc:"🇫🇮", nm:"Nokia Corporation", v:"photonics", s:"Transport", r:22000, g:43, mc:57428, pe:14, pr:"PSE-6s optical engine", d:"Completed \u20AC2.3B Infinera acquisition giving ~20% combined optical market share globally. BofA forecasts 17% optical CAGR through 2028. 3.5-4% dividend yield.", ri:["Mobile networks business headwinds"], ca:["BofA upgrade to Buy","\u20AC3.4B net cash position"], dc:{f:1800,gr:8,w:8.5,tg:2,sh:5600}, ms:{ta:.5,ch:.3,ai:.7,ra:.5}, fin:{beta:.9,eps:.21,div:.08,rg:[-5,0,3,5,8]} },
  { t:"AEHR", themes:["ai"], cc:"🇺🇸", nm:"Aehr Test Systems", v:"photonics", s:"Test", r:100, g:-10, mc:2481, pe:35, pr:"FOX-XP wafer burn-in", d:"Wafer-level burn-in testing for silicon photonics. Q3 FY2026 bookings surged to $37.2M (book-to-bill >3.5x). Stock up over 200% in 2026.", ri:["Lumpy order flow from small customer base"], ca:["$50.9M record effective backlog","New SiPh customer (global networking leader)"], dc:{f:-2,gr:80,w:14,tg:3,sh:30}, ms:{ta:.2,ch:.2,ai:.9,ra:.3}, fin:{beta:2.0,eps:-.17,div:0,rg:[-20,5,40,60,80]} },
  { t:"FORM", themes:["ai"], cc:"🇺🇸", nm:"FormFactor Inc", v:"photonics", s:"Test", r:540, g:48.2, mc:9687, pe:22, pr:"Probe cards + CPO testing", d:"Global leader in semiconductor wafer probe cards. Acquired Keystone Photonics for CPO testing capabilities. Record HBM probe card revenue.", ri:["Cyclical semiconductor capital equipment exposure"], ca:["CPO testing positioning via Keystone","Record HBM probe revenue"], dc:{f:120,gr:12,w:10,tg:3,sh:76}, ms:{ta:.3,ch:.3,ai:.8,ra:.4}, fin:{beta:1.3,eps:1.90,div:0,rg:[0,3,5,8,12]} },
  { t:"NVDA", themes:["ai","quantum","robotics"], cc:"🇺🇸", nm:"NVIDIA Corporation", v:"compute", s:"GPU", r:215900, g:73, mc:4816479, pe:41, pr:"Blackwell B200 / GB200 NVL72", d:"Dominant AI GPU maker with approximately 90% training market share. Blackwell architecture shipping at scale. Annual revenue run-rate exceeds $130 billion.", ri:["China export controls limit TAM","Hyperscaler custom ASIC competition"], ca:["GB200 NVL72 rack-scale ramp","Inference TAM expansion"], dc:{f:65000,gr:22,w:9,tg:3,sh:24300}, ms:{ta:.6,ch:.7,ai:.99,ra:.3}, fin:{beta:2.33,eps:4.90,div:.04,rg:[30,60,120,180,220]}, rs:[["Data Center (AI)",90],["Gaming",7],["Pro Viz",2],["Automotive",1],["Networking (in DC)",0]], geo:[["US",47],["Singapore (transit)",18],["Taiwan",14],["China",13],["Other Asia",8]], tc:[["Microsoft",19],["Meta",13],["Google/Alphabet",7],["Amazon",6],["Oracle",6],["Other cloud/enterprise",32],["Gaming/OEM/other",17]], pl:[{name:"Blackwell Ultra (B300 / GB300 NVL72)",desc:"Current flagship · FY26 volume ramp · 91% of DC revenue Q4",pos:"Flagship"},{name:"Rubin (R100 / VR200 NVL144)",desc:"Next-gen architecture · production 2026",pos:"Roadmap"},{name:"Hopper H100 / H200",desc:"Prior-gen · still shipping · long tail",pos:"Legacy"},{name:"NVLink / NVSwitch",desc:"GPU interconnect · 1.8 TB/s · NVL72 scale-up · Networking 162% YoY growth",pos:"Moat"},{name:"Spectrum-X / Mellanox",desc:"AI Ethernet switching · ConnectX-8 NICs · InfiniBand NDR/XDR",pos:"Networking stack"},{name:"CUDA · NIM · AI Enterprise",desc:"Software moat · 4M+ developers",pos:"Software"},{name:"Grace CPU · DGX · Omniverse",desc:"Arm-based CPU · integrated systems · simulation",pos:"Portfolio"}], cp:["AMD","INTC","AVGO","TSM (customer too)","Huawei (China)","Cerebras (pvt)","Groq (pvt)"], ops:{hq:"Santa Clara, CA",fd:1993,emp:36000,mfg:["Fabless · TSMC N4P/N3 · CoWoS"],ne:"Late May 2026"}, own:{insider:4,institutional:68} },
  { t:"AMD", themes:["ai","quantum"], cc:"🇺🇸", nm:"Advanced Micro Devices", v:"compute", s:"GPU", r:34600, g:52, mc:445675, pe:99, pr:"MI300X / MI350 accelerators", d:"Number two AI GPU supplier. MI300X gaining hyperscaler traction. Strong combined CPU (EPYC) and GPU portfolio plus FPGA via Xilinx.", ri:["CUDA ecosystem competitive moat"], ca:["MI350 next-gen launch","Instinct platform adoption growth"], dc:{f:5500,gr:25,w:10,tg:3,sh:1630}, ms:{ta:.5,ch:.6,ai:.95,ra:.3}, fin:{beta:1.96,eps:2.65,div:0,rg:[10,25,40,55,70]}, rs:[["Data Center (Instinct + EPYC)",50],["Client (Ryzen CPU)",27],["Gaming",10],["Embedded (Xilinx)",13]], geo:[["US",35],["Taiwan",20],["China",18],["Japan",7],["Other",20]], tc:[["Microsoft/Oracle/Meta (AI)",28],["Dell/HPE/Lenovo",22],["Gaming consoles (Sony/MS)",8],["Enterprise distribution",25],["Other",17]], pl:[{name:"Instinct MI350 / MI355X",desc:"CDNA 4 AI accelerator · 288GB HBM3E · shipping 2H25",pos:"Flagship AI GPU"},{name:"Instinct MI400 / Helios",desc:"Rubin competitor · 2026 · rack-scale UALink",pos:"Next-gen"},{name:"EPYC Turin (Zen 5)",desc:"Data center CPU · 192 cores · share-gain vs Intel",pos:"Franchise"},{name:"Ryzen AI Max / Strix",desc:"Consumer + commercial CPU+NPU SOCs",pos:"Client"},{name:"Pensando DPU",desc:"Smart NICs · hyperscaler AI networking",pos:"Adjacent"},{name:"Xilinx FPGA / Versal AI",desc:"Embedded + telecom + defense",pos:"Diversification"}], cp:["NVDA","INTC","AVGO","ARM","QCOM"], ops:{hq:"Santa Clara, CA",fd:1969,emp:28000,mfg:["Fabless · TSMC N3/N4"],ne:"Early May 2026"}, own:{insider:.2,institutional:73} },
  { t:"AVGO", themes:["ai"], cc:"🇺🇸", nm:"Broadcom Inc", v:"compute", s:"Custom ASIC", r:63900, g:68, mc:1881452, pe:74, pr:"Custom XPU + Tomahawk switch ASIC", d:"Designs custom AI silicon for 6 strategic hyperscalers including Google TPU. AI semiconductor revenue reached $22.1B. VMware acquisition adds $27B recurring software.", ri:["$66B total debt from VMware acquisition"], ca:["Over $100B AI chip revenue target by FY2027","$26.9B annual free cash flow"], dc:{f:26900,gr:18,w:9,tg:3,sh:4730}, ms:{ta:.4,ch:.5,ai:.9,ra:.3}, fin:{beta:1.25,eps:5.30,div:2.12,rg:[8,15,22,30,38]}, rs:[["Semiconductor Solutions (AI+networking)",58],["Infrastructure Software (VMware+legacy)",42]], geo:[["US",42],["China",28],["Other Asia",22],["Europe",8]], tc:[["Apple (iPhone RF/components)",20],["Google (TPU ASIC)",14],["Meta (MTIA ASIC)",11],["ByteDance/other XPU",8],["Enterprise software",25],["Other",22]], pl:[{name:"Custom AI ASICs (XPU)",desc:"Google TPU v6/v7 Ironwood · Meta MTIA · ByteDance · OpenAI in development",pos:"Hyperscaler silicon"},{name:"Tomahawk 5 / Tomahawk 6",desc:"51.2T / 102.4T Ethernet switch ASICs · AI fabric backbone",pos:"Networking leader"},{name:"Jericho3-AI",desc:"Deep-buffer switch for AI scale-out · shared w/ ANET",pos:"Key fabric"},{name:"VMware Cloud Foundation",desc:"Private cloud bundle · price / license reset post-acq",pos:"SW anchor"},{name:"Symantec + CA",desc:"Security + mainframe SW · recurring",pos:"Legacy SW"},{name:"Wireless (Apple)",desc:"FBAR filters · Wi-Fi 7 · BlueTooth · RF front-ends",pos:"Franchise"}], cp:["MRVL","NVDA (Spectrum-X)","ARM","Alchip (ASIC)","GUC (ASIC)"], ops:{hq:"Palo Alto, CA",fd:1991,emp:37000,mfg:["Fabless · TSMC N3/N5 · Samsung"],ne:"Early June 2026"}, own:{insider:2,institutional:78} },
  { t:"INTC", themes:["ai","quantum"], cc:"🇺🇸", nm:"Intel Corporation", v:"compute", s:"Foundry", r:52900, g:41, mc:340943, pe:null, pr:"Gaudi 3 / Intel 18A foundry", d:"Major restructuring underway. Intel Foundry Services pursuing external customers. Gaudi AI accelerators lag NVIDIA and AMD.", ri:["Execution risk on process technology"], ca:["Intel 18A process node","US CHIPS Act funding"], dc:{f:-2000,gr:15,w:12,tg:2,sh:5020}, ms:{ta:.4,ch:.3,ai:.7,ra:.5}, fin:{beta:1.0,eps:-4.38,div:0,rg:[-10,-5,0,5,15]}, rs:[["Client Computing (PC)",55],["DCAI (Data Center + AI)",26],["Network & Edge",9],["Foundry Services (external)",3],["Mobileye (majority-owned)",4],["Other",3]], geo:[["US",29],["Singapore",22],["China",22],["Taiwan",14],["Other",13]], tc:[["Dell",18],["HP Inc.",14],["Lenovo",10],["HPE",8],["Hyperscaler (Azure/AWS/GCP)",22],["Other",28]], pl:[{name:"Intel 18A process",desc:"Backside power delivery + RibbonFET · Panther Lake · ramp 2025-26",pos:"Turnaround bet"},{name:"Xeon 6 · Sierra Forest · Granite Rapids",desc:"Data center CPU · share-loss vs AMD",pos:"Core DC"},{name:"Core Ultra (Arrow Lake / Panther Lake)",desc:"AI PC · NPU 48-TOPS",pos:"Client"},{name:"Gaudi 3",desc:"AI accelerator · significant cancellations · end-of-life",pos:"Strategic retreat"},{name:"IFS (Intel Foundry)",desc:"External customers · AWS · Microsoft · heavy losses",pos:"Execution-critical"},{name:"Altera FPGA",desc:"Spun out majority · retained minority · standalone Co",pos:"Divested"}], cp:["AMD","NVDA","TSM (foundry rival)","QCOM (ARM PCs)","ARM","Samsung Foundry"], ops:{hq:"Santa Clara, CA",fd:1968,emp:108000,mfg:["Chandler AZ (Fab 42/52/62)","Hillsboro OR (D1X)","Ohio (20A/18A new)","Kiryat Gat Israel","Leixlip Ireland"],ne:"Late Apr 2026"}, own:{insider:.1,institutional:66} },
  { t:"TSM", themes:["ai"], cc:"🇹🇼", nm:"TSMC", v:"compute", s:"Foundry", r:122420, g:60, mc:1885026, pe:28, pr:"3nm/2nm AI chip fabrication", d:"Fabricates over 90% of all advanced AI chips for NVIDIA, AMD, Broadcom, Marvell. Irreplaceable supply chain chokepoint. 2nm ramping 2025.", ri:["Taiwan geopolitical risk"], ca:["2nm process ramp","Arizona fab construction","CoWoS packaging expansion"], dc:{f:32000,gr:18,w:9,tg:3,sh:5200}, ms:{ta:.5,ch:.4,ai:.95,ra:.3}, fin:{beta:1.2,eps:6.20,div:1.84,rg:[10,18,28,40,52]}, rs:[["HPC (AI/GPU/server CPU)",58],["Smartphone",28],["IoT",5],["Automotive",5],["DCE",4]], geo:[["North America",70],["Asia-Pacific ex-China",17],["China",11],["EMEA",2]], tc:[["Apple",23],["NVIDIA",20],["AMD",9],["Qualcomm",7],["Broadcom",7],["MediaTek",5],["Other fabless",29]], pl:[{name:"N3/N3E/N3P",desc:"3nm family · Apple M4/A18 · AMD MI350 · NVIDIA Blackwell",pos:"Current flagship"},{name:"N2 / N2P",desc:"2nm gate-all-around · Apple anchor 2025-26 · Nvidia Rubin",pos:"Next leading"},{name:"A16 (Angstrom)",desc:"Backside power delivery + GAA · ~2027 target",pos:"Roadmap"},{name:"CoWoS advanced packaging",desc:"AI GPU bottleneck · 2x supply build-out 2025-26",pos:"Critical constraint"},{name:"SoIC 3D stacking",desc:"Vertical die stacking · AMD MI300 architecture",pos:"Differentiator"},{name:"N4P / N5 / N6",desc:"Mainstream nodes · automotive · China workarounds",pos:"Workhorse"}], cp:["Samsung Foundry","Intel Foundry (nascent)","GF","SMIC (China domestic)"], ops:{hq:"Hsinchu, Taiwan",fd:1987,emp:77000,mfg:["Hsinchu TW (Fab 18)","Tainan TW (Fab 20/21)","Arizona US (Fab 21)","Kumamoto JP (JASM)","Dresden DE (ESMC)"],ne:"Mid July 2026"}, own:{insider:6,institutional:20} },
  { t:"ARM", themes:["ai"], cc:"🇬🇧", nm:"Arm Holdings", v:"compute", s:"IP", r:4100, g:96, mc:166814, pe:120, pr:"CPU architecture IP licenses", d:"CPU architecture IP present in every smartphone and growing server share via Neoverse. Pure royalty model delivers 96% gross margin.", ri:["180x P/E valuation premium"], ca:["Neoverse server CPU adoption","AI edge compute growth"], dc:{f:1800,gr:22,w:11,tg:3,sh:1030}, ms:{ta:.2,ch:.3,ai:.7,ra:.3}, fin:{beta:1.8,eps:.92,div:0,rg:[15,22,30,38,48]}, rs:[["Royalties (per-chip)",54],["License Fees",46]], geo:[["Asia (shipment)",50],["US",30],["Europe",20]], tc:[["Apple",14],["Qualcomm",10],["MediaTek",8],["Samsung LSI",7],["NVIDIA (Grace)",6],["Other fabless",55]], pl:[{name:"Armv9 architecture",desc:"Confidential Compute + SVE2 · all new designs",pos:"Core IP"},{name:"Cortex-X Premium (Blackhawk)",desc:"Flagship performance core · mobile/PC",pos:"Leading"},{name:"Neoverse V3 / N3",desc:"Server / infra CPU cores · Graviton4 / Cobalt based",pos:"Server entry"},{name:"Total Design CSS",desc:"Chiplet reference platform",pos:"Ecosystem play"},{name:"Ethos NPU",desc:"ML acceleration IP",pos:"Emerging"},{name:"Mali GPU / Immortalis",desc:"Mobile graphics IP",pos:"Franchise"}], cp:["Intel (x86)","AMD","RISC-V ecosystem (SiFive/Tenstorrent/pvt)"], ops:{hq:"Cambridge, UK",fd:1990,emp:7300,ne:"Early May 2026"}, own:{insider:89,institutional:10} },
  { t:"SKHYNIX", themes:["ai"], cc:"🇰🇷", nm:"SK Hynix", v:"memory", s:"HBM", r:55000, g:42, mc:130000, pe:8, pr:"HBM3E memory stacks", d:"Number one HBM supplier with approximately 50% market share. Sole HBM3E supplier qualified for NVIDIA Blackwell. Record profitability.", ri:["Cyclical memory pricing exposure"], ca:["HBM3E sole-source for NVIDIA","HBM4 development underway"], dc:{f:18000,gr:15,w:10,tg:2,sh:730}, ms:{ta:.6,ch:.5,ai:.95,ra:.4}, fin:{beta:1.3,eps:22.50,div:1.20,rg:[-20,15,50,80,100]}, rs:[["DRAM",62],["NAND",36],["System IC/Other",2]], geo:[["Asia (shipment)",82],["US",12],["Europe",6]], tc:[["NVIDIA (HBM3E/4 primary)",28],["Apple",12],["Samsung (internal devices)",8],["Dell/HPE",7],["Hyperscalers direct",20],["Other",25]], pl:[{name:"HBM3E 12H",desc:"Primary HBM for NVIDIA Blackwell · early leader",pos:"HBM share leader"},{name:"HBM4 (2026)",desc:"Next-gen · Rubin target · 2560-bit",pos:"Roadmap"},{name:"DDR5 server + LPDDR5X",desc:"Mainstream DRAM · AI PCs",pos:"Franchise"},{name:"3D NAND (238-layer)",desc:"PC + data center SSDs",pos:"Scale business"},{name:"Solidigm (acquired Intel NAND)",desc:"Data center SSD specialist",pos:"Bolt-on"}], cp:["Samsung","MU","YMTC (NAND)","CXMT (DRAM China)"], ops:{hq:"Icheon, South Korea",fd:1983,emp:31000,ne:"Late Jul 2026"}, own:{insider:20,institutional:40} },
  { t:"MU", themes:["ai"], cc:"🇺🇸", nm:"Micron Technology", v:"memory", s:"HBM", r:33500, g:36, mc:499048, pe:12, pr:"HBM3E + datacenter DRAM", d:"Third largest memory maker. HBM3E ramping for AI accelerators. Idaho and New York CHIPS Act fab expansion underway.", ri:["Memory cycle pricing volatility"], ca:["HBM3E volume production ramp","$50B+ CHIPS Act facility support"], dc:{f:8500,gr:18,w:10,tg:2,sh:1100}, ms:{ta:.5,ch:.4,ai:.9,ra:.4}, fin:{beta:1.4,eps:6.65,div:.46,rg:[-15,10,30,50,65]}, rs:[["DRAM",76],["NAND",22],["Other",2]], geo:[["Taiwan/China (shipment)",45],["US",12],["Other Asia",28],["Europe",15]], tc:[["NVIDIA (HBM)",18],["Dell/HPE (servers)",14],["Apple",11],["Lenovo",8],["AMD",6],["Hyperscalers direct",18],["Other",25]], pl:[{name:"HBM3E 8H / 12H",desc:"NVIDIA Blackwell qualification · Micron now 2nd-source beside SK Hynix",pos:"AI memory flagship"},{name:"HBM4 (2026)",desc:"Next-gen HBM for Rubin · 2560-bit interface",pos:"Roadmap"},{name:"DDR5 server",desc:"Data-center RAM · 48GB/64GB densities",pos:"Franchise"},{name:"LPDDR5X",desc:"Mobile + AI PC memory · surging with AI PCs",pos:"Growth"},{name:"GDDR7",desc:"Gaming + AI inference · Blackwell RTX50",pos:"Niche"},{name:"9550 / 7500 SSDs",desc:"Data center PCIe Gen5",pos:"NAND"}], cp:["SK Hynix","Samsung","YMTC (NAND China)","CXMT (DRAM China)"], ops:{hq:"Boise, ID",fd:1978,emp:48000,mfg:["Boise ID","Manassas VA","Taichung TW","Hiroshima JP","Singapore"],ne:"Late June 2026"}, own:{insider:.1,institutional:84} },
  { t:"SAMSUNG", themes:["ai"], cc:"🇰🇷", nm:"Samsung Electronics", v:"memory", s:"HBM", r:220000, g:35, mc:350000, pe:15, pr:"HBM3E + NAND + foundry", d:"Diversified memory plus foundry conglomerate. Playing catch-up in HBM versus SK Hynix. Investing heavily in advanced packaging.", ri:["HBM qualification delays versus SK Hynix"], ca:["HBM3E catch-up production ramp"], dc:{f:25000,gr:10,w:9,tg:2,sh:5970}, ms:{ta:.4,ch:.3,ai:.85,ra:.3}, fin:{beta:1.1,eps:9.80,div:2.10,rg:[-8,5,15,25,35]}, rs:[["DX (Device eXperience - mobile/display/CE)",60],["DS (Device Solutions - memory/foundry)",35],["Harman (audio)",4],["Other",1]], geo:[["Americas",36],["Korea",12],["Europe",17],["Asia ex-Korea",35]], tc:[["Consumer (mobile/CE)",60],["Foundry (Tesla/Qualcomm/NVDA limited)",12],["Memory (Apple/NVDA/Dell)",22],["Other",6]], pl:[{name:"Memory (DRAM + NAND + HBM)",desc:"Catching SK Hynix on HBM3E · HBM4 leadership target",pos:"#2 memory"},{name:"Foundry (2nm GAA)",desc:"2nm ramp · Tesla Dojo 2 · aiming NVDA N2 share",pos:"Challenging TSMC"},{name:"Galaxy S/Z/A smartphones",desc:"Mobile franchise · AI-first",pos:"Category leader"},{name:"Display OLED (Quantum Dot)",desc:"Apple + BOE competitor",pos:"Franchise"},{name:"Harman (audio)",desc:"Auto audio + connected car",pos:"Diversifier"}], cp:["SK Hynix","MU","TSM","Apple","Xiaomi","LG"], ops:{hq:"Suwon, South Korea",fd:1938,emp:267000,ne:"Late Jul 2026"}, own:{insider:20,institutional:45} },
  { t:"VRT", themes:["ai"], cc:"🇺🇸", nm:"Vertiv Holdings", v:"power", s:"Thermal", r:9000, g:37, mc:111709, pe:55, pr:"Liquid cooling systems + UPS + PDU", d:"Number one datacenter thermal management provider. Liquid cooling solutions for AI racks running at 50-100kW per rack. Record order backlog.", ri:["Supply chain execution on backlog"], ca:["Liquid cooling adoption curve accelerating","AI rack power density growth"], dc:{f:1200,gr:22,w:10,tg:3,sh:380}, ms:{ta:.4,ch:.1,ai:.9,ra:.4}, fin:{beta:1.5,eps:3.45,div:.10,rg:[10,18,28,38,50]}, rs:[["Americas",53],["Asia Pacific",23],["EMEA",24]], geo:[["Americas",53],["APAC",23],["EMEA",24]], tc:[["Hyperscalers (MSFT/META/AMZN/GOOG)",40],["Colocation operators (EQIX/DLR/QTS)",22],["Telecom",15],["Enterprise",18],["Industrial",5]], pl:[{name:"Liebert UPS",desc:"High-power UPS · Trinergy (MW-scale) · critical for AI halls",pos:"#1 UPS globally"},{name:"Vertiv CoolPhase Liquid Cooling",desc:"Direct-to-chip liquid cooling · scaling with Blackwell",pos:"Fast-growing"},{name:"Switchgear & Power Distribution",desc:"Busway · breakers · panel builds for 10MW+ halls",pos:"Franchise"},{name:"DX cooling (Crown, iCOM)",desc:"Traditional DC cooling",pos:"Base"},{name:"Prefabricated Modular DC",desc:"Factory-built modular halls · rapid deploy",pos:"Growth SKU"}], cp:["Schneider Electric","Eaton (ETN)","ABB/ABBNY","Trane","Carrier"], ops:{hq:"Westerville, OH",fd:2016,emp:31000,bl:{label:"Backlog",val:7.9,unit:"B"},ne:"Late Apr 2026"}, own:{insider:2,institutional:85} },
  { t:"ETN", themes:["ai"], cc:"🇮🇪", nm:"Eaton Corporation", v:"power", s:"Power", r:25000, g:36, mc:155034, pe:35, pr:"Switchgear + UPS + power distribution", d:"Critical datacenter electrical infrastructure backbone. Switchgear, UPS systems, and power distribution units. Multi-year backlog growth.", ri:["Broad industrial exposure dilutes AI thesis"], ca:["Datacenter electrical demand surge"], dc:{f:4200,gr:12,w:9,tg:3,sh:395}, ms:{ta:.3,ch:.1,ai:.8,ra:.4}, fin:{beta:1.0,eps:9.15,div:3.44,rg:[5,8,12,15,18]}, rs:[["Electrical Americas",40],["Electrical Global",20],["Aerospace",15],["Vehicle",11],["eMobility",14]], geo:[["Americas",58],["EMEA",22],["APAC",20]], tc:[["Hyperscalers (AI DC)",22],["Industrial / utilities",28],["Aerospace (commercial + defense)",15],["Commercial construction",15],["Residential + light commercial",12],["Vehicle/eMobility",8]], pl:[{name:"Power Distribution (MV)",desc:"Medium-voltage switchgear · AI data center surge",pos:"AI tailwind"},{name:"UPS + Power Quality",desc:"Liebert-class datacenter UPS (competes w/ VRT)",pos:"Growth"},{name:"Aerospace Actuation",desc:"Hydraulic + fuel systems · Pratt + Airbus",pos:"Franchise"},{name:"eMobility",desc:"EV charging + power conversion",pos:"Growth vector"},{name:"Vehicle Group",desc:"Commercial truck + HD powertrains",pos:"Cyclical"}], cp:["Schneider","ABBNY","VRT","Siemens","Hubbell"], ops:{hq:"Dublin, Ireland",fd:1911,emp:92000,bl:{label:"Backlog",val:12,unit:"B"},ne:"Early May 2026"}, own:{insider:.1,institutional:84} },
  { t:"POWL", themes:["ai"], cc:"🇺🇸", nm:"Powell Industries", v:"power", s:"Power", r:1100, g:30, mc:2766, pe:20, pr:"Custom electrical switchgear", d:"Custom electrical switchgear for large datacenter facilities. Direct beneficiary of hyperscaler datacenter buildout wave.", ri:["Customer concentration risk"], ca:["Datacenter construction wave"], dc:{f:120,gr:25,w:11,tg:3,sh:12}, ms:{ta:.3,ch:.1,ai:.85,ra:.3}, fin:{beta:1.2,eps:16.80,div:1.08,rg:[10,20,40,60,80]} },
  { t:"GEV", themes:["ai","nuclear"], cc:"🇺🇸", nm:"GE Vernova", v:"power", s:"Generation", r:35000, g:25, mc:268111, pe:50, pr:"Gas turbines + grid equipment", d:"Power generation and grid infrastructure equipment. AI datacenters require massive baseload power at 100MW+ per campus.", ri:["Grid expansion execution challenges"], ca:["Datacenter power demand surge","Grid modernization spending"], dc:{f:2800,gr:15,w:10,tg:3,sh:275}, ms:{ta:.3,ch:.1,ai:.85,ra:.5}, fin:{beta:1.3,eps:6.30,div:0,rg:[0,5,12,18,25]}, rs:[["Power (gas + nuclear services)",54],["Wind",30],["Electrification",16]], geo:[["Americas",52],["EMEA",26],["APAC",22]], tc:[["Utilities (global)",55],["Independent power producers",20],["Industrial/commercial",15],["Offshore wind developers",10]], pl:[{name:"HA-class gas turbines",desc:"9HA.02 most efficient · AI data center baseload",pos:"Category leader"},{name:"BWRX-300 SMR (Hitachi JV)",desc:"First SMR deployments · OPG Darlington · TVA",pos:"Flagship SMR"},{name:"Onshore wind turbines",desc:"5MW+ platforms · restructuring underway",pos:"Challenged"},{name:"Offshore Haliade-X",desc:"14-18 MW · slower growth post-IRA uncertainty",pos:"Franchise"},{name:"Grid Solutions (electrification)",desc:"HVDC + transformers · AI DC tailwind",pos:"Growth"}], cp:["Siemens Energy","Mitsubishi Power","Vestas (onshore)","Westinghouse","Siemens Gamesa"], ops:{hq:"Cambridge, MA",fd:2024,emp:75000,bl:{label:"Backlog",val:186,unit:"B"},ne:"Late Apr 2026"}, own:{insider:.1,institutional:82} },
  { t:"ANET", themes:["ai"], cc:"🇺🇸", nm:"Arista Networks", v:"networking", s:"Switching", r:7000, g:53, mc:49332, pe:50, pr:"7800R AI spine switches", d:"Number one cloud networking provider. 400G/800G AI spine switches deployed at scale. Microsoft and Meta are top two customers.", ri:["Microsoft and Meta customer concentration"], ca:["800G AI back-end networking fabric ramp"], dc:{f:3200,gr:20,w:10,tg:3,sh:310}, ms:{ta:.3,ch:.2,ai:.95,ra:.3}, fin:{beta:1.30,eps:10.00,div:0,rg:[15,22,30,40,52]}, rs:[["Products (switches+routers)",86],["Services",14]], geo:[["US",78],["Europe",12],["APAC",10]], tc:[["Microsoft",38],["Meta",24],["Other Titans (Apple/Oracle/Google)",18],["Enterprise",15],["Financial services",5]], pl:[{name:"7800R3 / 7700R4 AI Series",desc:"Deep-buffer AI data center switches · Jericho3-AI based",pos:"Flagship AI"},{name:"Etherlink (AI Ethernet)",desc:"Open standard for AI fabric · alt to NVDA InfiniBand",pos:"Standard-setter"},{name:"7280R3 / 7800 data center",desc:"Tomahawk 5-based 51.2T switches",pos:"Core franchise"},{name:"CloudVision EOS",desc:"Extensible network OS · software differentiator",pos:"Stickiness"},{name:"800G + 1.6T platforms",desc:"Latest-gen hyperscale fabric",pos:"Leading edge"}], cp:["NVDA (Spectrum-X)","CSCO","Juniper","Nokia (IP)","HPE (Aruba)"], ops:{hq:"Santa Clara, CA",fd:2004,emp:4100,ne:"Early May 2026"}, own:{insider:15,institutional:71} },
  { t:"CSCO", themes:["ai"], cc:"🇺🇸", nm:"Cisco Systems", v:"networking", s:"Switching", r:55000, g:64, mc:333822, pe:17, pr:"Silicon One ASIC + Nexus 9000", d:"Enterprise networking giant. Custom Silicon One ASIC platform. Splunk acquisition adds $28B in observability. AI networking orders accelerating.", ri:["Slower growth profile versus Arista"], ca:["AI networking order acceleration","Silicon One custom ASIC platform"], dc:{f:14000,gr:6,w:8.5,tg:2,sh:3980}, ms:{ta:.3,ch:.2,ai:.8,ra:.3}, fin:{beta:.9,eps:3.00,div:1.60,rg:[-2,3,5,6,8]}, rs:[["Networking (switches/routers)",48],["Security",11],["Collaboration",10],["Services",24],["Observability (Splunk)",7]], geo:[["Americas",58],["EMEA",26],["APAC",16]], tc:[["Enterprise F500",60],["Service providers/telcos",20],["US govt/federal",10],["SMB",10]], pl:[{name:"Nexus 9000 AI-ready",desc:"Data center switches · Silicon One ASICs · 51.2T",pos:"Enterprise fabric leader"},{name:"Silicon One (G200)",desc:"In-house AI network chip · competing w/ AVGO Tomahawk",pos:"Silicon bet"},{name:"Splunk (acquired $28B 2024)",desc:"Observability + SIEM · now core to security suite",pos:"Strategic acq"},{name:"Webex + Collab",desc:"Enterprise communications · declining",pos:"Cash cow"},{name:"Catalyst / Meraki",desc:"Enterprise + cloud-managed branch",pos:"Franchise"},{name:"Hypershield security",desc:"AI-native security · 2024 launch",pos:"Positioning"}], cp:["ANET","Juniper","HPE (Aruba)","Palo Alto","NVDA"], ops:{hq:"San Jose, CA",fd:1984,emp:90000,ne:"Mid May 2026"}, own:{insider:.1,institutional:72} },
  { t:"JNPR", themes:["ai"], cc:"🇺🇸", nm:"Juniper / HPE", v:"networking", s:"Switching", r:5700, g:57, mc:13200, pe:20, pr:"AI-native networking platform", d:"HPE acquisition completed. Cloud and AI networking portfolio with Apstra intent-based automation.", ri:["HPE integration execution risk"], ca:["HPE synergies realization"], dc:{f:850,gr:8,w:9,tg:2,sh:330}, ms:{ta:.2,ch:.1,ai:.7,ra:.3}, fin:{beta:1.0,eps:1.88,div:.88,rg:[0,3,5,8,10]}, rs:[["Routing",44],["Switching",20],["Security",18],["Services",18]], geo:[["Americas",60],["EMEA",24],["APAC",16]], tc:[["Cloud providers",35],["Service providers/telcos",32],["Enterprise",28],["Other",5]], pl:[{name:"PTX10000 routers",desc:"400G+ core routing for cloud/telco backbones",pos:"Share leader"},{name:"Mist AI-driven networking",desc:"AI-ops for enterprise WLAN · Marvis assistant",pos:"Differentiator"},{name:"Apstra intent-based",desc:"Multi-vendor automation",pos:"Software layer"},{name:"QFX data center",desc:"Leaf/spine fabric · AI workloads",pos:"Competing vs ANET/CSCO"},{name:"HPE pending acquisition",desc:"$14B · pending closing 2025 (DOJ issues)",pos:"M&A event"}], cp:["CSCO","ANET","NVDA","Nokia (IP)"], ops:{hq:"Sunnyvale, CA",fd:1996,emp:10500,ne:"Pending HPE merger"}, own:{insider:.2,institutional:91} },
  { t:"EQIX", themes:["ai"], cc:"🇺🇸", nm:"Equinix", v:"dcInfra", s:"REIT", r:9000, g:48, mc:103518, pe:80, pr:"Colocation + xScale hyperscale", d:"Largest global datacenter REIT operating 270+ facilities across 72 metros. xScale program targets hyperscaler AI deployments.", ri:["High debt typical of REIT structure"], ca:["xScale AI deployment program","Interconnection revenue growth"], dc:{f:3200,gr:8,w:7,tg:2,sh:97}, ms:{ta:.2,ch:.1,ai:.85,ra:.6}, fin:{beta:.8,eps:5.22,div:16.52,rg:[5,8,10,12,15]}, rs:[["Colocation (recurring)",85],["Interconnection",12],["Managed services",3]], geo:[["Americas",45],["EMEA",33],["APAC",22]], tc:[["Cloud & IT (hyperscalers)",35],["Network providers",24],["Financial services",12],["Enterprise",19],["Content + digital",10]], pl:[{name:"xScale JVs (hyperscale)",desc:"JVs w/ GIC + PGIM · 3+ GW pipeline for MSFT/AWS/GOOG",pos:"AI DC flagship"},{name:"IBX colocation",desc:"260+ data centers · 66 metros",pos:"Franchise"},{name:"Platform Equinix interconnect",desc:"Fabric + direct cloud connect · 480k+ connections",pos:"Platform moat"},{name:"Equinix Metal bare-metal",desc:"On-demand dedicated infra",pos:"Adjacency"},{name:"Private AI deployments",desc:"GPU colocation · liquid-cooled",pos:"Growth"}], cp:["DLR","CoreSite (AMT)","NTT","Cyxtera (BK)"], ops:{hq:"Redwood City, CA",fd:1998,emp:13000,ne:"Early May 2026"}, own:{insider:.4,institutional:94} },
  { t:"DLR", themes:["ai"], cc:"🇺🇸", nm:"Digital Realty", v:"dcInfra", s:"REIT", r:5800, g:55, mc:63440, pe:85, pr:"Wholesale hyperscale datacenter", d:"Second largest datacenter REIT with wholesale and hyperscale focus. Over 300 datacenters globally. Record leasing activity in 2025.", ri:["Power procurement challenges"], ca:["Record datacenter leasing activity","AI-driven demand acceleration"], dc:{f:2100,gr:10,w:7.5,tg:2,sh:320}, ms:{ta:.2,ch:.1,ai:.8,ra:.6}, fin:{beta:.7,eps:1.97,div:4.88,rg:[3,5,8,10,12]}, rs:[["Colocation (recurring)",75],["Hyperscale leasing",22],["Services",3]], geo:[["Americas",58],["EMEA",28],["APAC",14]], tc:[["Hyperscalers (MSFT/AMZN/META/GOOG)",45],["Enterprise",30],["Network/SaaS",15],["Financial services",10]], pl:[{name:"PlatformDIGITAL",desc:"Global colo platform · 300+ data centers",pos:"Franchise"},{name:"Hyperscale build-to-suit",desc:"MW-scale AI campus leases · Northern VA/Phoenix",pos:"AI growth vector"},{name:"Interxion EMEA",desc:"European colo acquisition · network-dense",pos:"EMEA stronghold"},{name:"Liquid cooling retrofits",desc:"Existing IBXs upgrading for AI",pos:"Modernization"},{name:"ServiceFabric interconnect",desc:"Platform interconnect fabric",pos:"Ecosystem layer"}], cp:["EQIX","NTT","Switch (pvt, acq)","CoreSite (AMT)"], ops:{hq:"Austin, TX",fd:2004,emp:3600,ne:"Late Apr 2026"}, own:{insider:.4,institutional:95} },
  { t:"CRWV", themes:["ai"], cc:"🇺🇸", nm:"CoreWeave", v:"dcInfra", s:"GPU Cloud", r:2500, g:20, mc:57857, pe:null, pr:"GPU-as-a-service cloud platform", d:"NVIDIA-backed GPU cloud provider. IPO completed in 2025. Purpose-built infrastructure for AI workloads with $15B+ in contracted revenue.", ri:["Microsoft customer concentration","Massive debt load"], ca:["$15B+ contracted revenue backlog","Deep NVIDIA partnership"], dc:{f:-500,gr:80,w:15,tg:3,sh:490}, ms:{ta:.2,ch:.1,ai:.95,ra:.7}, fin:{beta:2.5,eps:-1.00,div:0,rg:[-50,50,150,200,250]}, rs:[["AI cloud compute (GPU hourly)",87],["Consulting & professional svcs",13]], geo:[["US",82],["Europe",12],["Other",6]], tc:[["Microsoft (primary anchor)",62],["OpenAI (direct)",19],["Other AI labs",12],["Enterprise",7]], pl:[{name:"GPU Cloud (Blackwell-native)",desc:"H100/H200/B200/B300 · 250k+ GPUs deployed",pos:"Neocloud leader"},{name:"Microsoft anchor contract",desc:"5-yr $22B+ compute commitment · flagship tenant",pos:"Cornerstone"},{name:"OpenAI direct (Stargate)",desc:"$11.9B agreement · pending Stargate overlap",pos:"AI-lab anchor"},{name:"Weights & Biases (acq 2025)",desc:"MLOps observability · developer reach",pos:"Software layer"},{name:"Data center pipeline",desc:"~1.8 GW contracted · CORZ/APLD/TLN co-located",pos:"Capacity moat"}], cp:["Lambda (pvt)","Nebius","AWS/Azure/GCP","IREN","WULF","CIFR"], ops:{hq:"Livingston, NJ",fd:2017,emp:1100,ne:"May 2026"}, own:{insider:45,institutional:35} },
  { t:"AMZN", themes:["ai","nuclear","robotics","quantum"], cc:"🇺🇸", nm:"Amazon (AWS)", v:"hyperscaler", s:"Cloud", r:650000, g:50, mc:2618490, pe:35, pr:"AWS AI/ML infrastructure", d:"Largest cloud provider with approximately 33% market share. Trainium custom AI training chips. Over $100B in planned 2025 capital expenditure.", ri:["Capital expenditure intensity pressure"], ca:["Trainium 2 custom chip launch","AWS AI revenue growing 30%+"], dc:{f:38000,gr:15,w:9,tg:3,sh:10500}, ms:{ta:.3,ch:.2,ai:.9,ra:.4}, fin:{beta:1.1,eps:5.80,div:0,rg:[8,12,18,25,32]}, rs:[["Online Stores",40],["AWS (Amazon Web Services)",17],["Third-party Seller Services",23],["Advertising",9],["Subscription Services (Prime)",7],["Physical Stores",3],["Other",1]], geo:[["North America",61],["International",22],["AWS (global)",17]], tc:[["Retail consumers (diversified)",70],["AWS enterprise customers",22],["3P sellers",8]], pl:[{name:"AWS (IaaS/PaaS)",desc:"#1 cloud · ~31% global share · Bedrock + SageMaker AI stack",pos:"Crown jewel"},{name:"Trainium 2 / 3",desc:"Custom AI training silicon · Anthropic anchor tenant · with MRVL",pos:"Silicon strategy"},{name:"Anthropic partnership",desc:"$8B investment · Claude exclusive on AWS Bedrock",pos:"AI tenant"},{name:"Inferentia 3",desc:"Custom AI inference silicon · cost-optimized",pos:"Inference"},{name:"Prime (subscription)",desc:"200M+ paying members · shipping + video",pos:"Moat"},{name:"Amazon Ads",desc:"3rd-largest US ad platform · 25%+ growth",pos:"High margin"},{name:"Bedrock + Q",desc:"Multi-model inference service + enterprise coding assistant",pos:"AI layer"}], cp:["MSFT","GOOG","WMT","AAPL","MongoDB","SHOP"], ops:{hq:"Seattle, WA",fd:1994,emp:1550000,ne:"Late Apr 2026"}, own:{insider:10,institutional:60} },
  { t:"MSFT", themes:["ai","quantum","nuclear"], cc:"🇺🇸", nm:"Microsoft (Azure)", v:"hyperscaler", s:"Cloud", r:281700, g:69, mc:3117182, pe:37, pr:"Azure AI + Copilot platform", d:"Second largest cloud provider with approximately 23% share. Strategic OpenAI partnership. Azure AI revenue growing over 60%. $80B+ planned 2025 capex.", ri:["OpenAI partnership dependency"], ca:["Copilot monetization across enterprise","Azure AI platform acceleration"], dc:{f:74000,gr:14,w:9,tg:3,sh:7430}, ms:{ta:.2,ch:.2,ai:.9,ra:.3}, fin:{beta:.9,eps:12.20,div:3.00,rg:[10,14,18,22,28]}, rs:[["Intelligent Cloud (Azure + server)",42],["Productivity (M365 + LinkedIn)",38],["More Personal Computing (Windows/Xbox)",20]], geo:[["US",52],["Europe",18],["Asia-Pacific",18],["ROW",12]], tc:[["Fortune 500 enterprise",55],["Consumer (Office/Windows)",20],["Gaming/Xbox",8],["SMB",12],["Government",5]], pl:[{name:"Azure OpenAI + Foundry",desc:"GPT-4 / o-series / Anthropic Claude · fastest-growing enterprise AI layer",pos:"Category leader"},{name:"M365 Copilot",desc:"AI assistant across Office · ~$30/user/mo · 4M+ paying",pos:"Flagship AI SKU"},{name:"Azure (core cloud)",desc:"IaaS/PaaS · ~30% global share · growing 30%+ YoY",pos:"Crown jewel"},{name:"Maia AI silicon",desc:"Custom AI accelerator (Maia 200 · 2026) · with AVGO/MRVL",pos:"Silicon strategy"},{name:"GitHub Copilot",desc:"Dev tool · bundled into M365 Copilot tier",pos:"Developer capture"},{name:"Windows + Xbox",desc:"Client OS + gaming (Activision)",pos:"Consumer base"},{name:"LinkedIn",desc:"B2B social · recurring subscription + ad revenue",pos:"Diversifier"}], cp:["GOOG","AMZN","META","CRM","ORCL"], ops:{hq:"Redmond, WA",fd:1975,emp:228000,ne:"Late Apr 2026"}, own:{insider:.1,institutional:73} },
  { t:"GOOG", themes:["ai","quantum","nuclear"], cc:"🇺🇸", nm:"Alphabet (GCP)", v:"hyperscaler", s:"Cloud", r:400000, g:58, mc:4057537, pe:25, pr:"TPU v5 + Gemini AI models", d:"Custom TPU silicon designed in partnership with Broadcom. Google Cloud Platform growing over 30% annually. Gemini AI model family. Number three cloud provider.", ri:["Antitrust regulatory scrutiny"], ca:["TPU Trillium next-gen launch","GCP AI workload growth acceleration"], dc:{f:72000,gr:12,w:9,tg:3,sh:12200}, ms:{ta:.2,ch:.2,ai:.85,ra:.3}, fin:{beta:1.0,eps:8.10,div:.80,rg:[8,15,22,28,35]}, rs:[["Google Search",56],["YouTube Ads",10],["Network Ads",7],["Google Cloud (GCP)",15],["Subscriptions/Platforms/Devices",11],["Other Bets",1]], geo:[["US",48],["EMEA",30],["APAC",16],["Other Americas",6]], tc:[["Ad advertisers (diversified)",68],["Cloud enterprise",18],["Consumer subs (YouTube Premium etc.)",10],["Hardware (Pixel/Fitbit)",4]], pl:[{name:"Gemini 2.5 / 3 (multimodal)",desc:"Flagship LLM · deepest multimodal · native tool use",pos:"Category challenger"},{name:"TPU v7 Ironwood",desc:"Custom AI chip · exclusive via AVGO · ~4x Blackwell perf/$",pos:"Silicon moat"},{name:"Google Search (core)",desc:"AI Overviews · generative search · ad monetization TBD",pos:"Cash engine"},{name:"YouTube + Shorts",desc:"Video platform · connected-TV expansion",pos:"Ad franchise"},{name:"GCP (Vertex AI · BigQuery)",desc:"Cloud platform · fastest growing",pos:"Growth engine"},{name:"Waymo",desc:"Autonomous ride-hail · SF/LA/PHX commercial · spinning out?",pos:"Other Bet"},{name:"Android · Pixel · Google One",desc:"Consumer platforms",pos:"Diversified"}], cp:["MSFT","META","AMZN","AAPL","OPENAI (pvt)","AMZN"], ops:{hq:"Mountain View, CA",fd:1998,emp:183000,ne:"Late Apr 2026"}, own:{insider:12,institutional:60} },
  { t:"META", themes:["ai","nuclear"], cc:"🇺🇸", nm:"Meta Platforms", v:"hyperscaler", s:"AI Infra", r:195000, g:82, mc:1707067, pe:26, pr:"MTIA custom chips + LLaMA models", d:"Massive AI infrastructure investor operating 600,000+ GPU training clusters. MTIA custom silicon program. Open-source LLaMA model family.", ri:["Metaverse capital expenditure burden"], ca:["MTIA custom chip production ramp","AI-driven advertising revenue growth"], dc:{f:52000,gr:15,w:9,tg:3,sh:2530}, ms:{ta:.2,ch:.1,ai:.85,ra:.3}, fin:{beta:1.2,eps:23.40,div:2.00,rg:[10,20,35,50,65]}, rs:[["Family of Apps (ads)",98],["Reality Labs (VR/AR)",2]], geo:[["US + Canada",45],["Europe",24],["Asia-Pacific",20],["ROW",11]], tc:[["Direct advertisers / agencies (diversified)",95],["Reality Labs consumers",3],["Payments/other",2]], pl:[{name:"Llama 4 / 5",desc:"Open-weight foundation models · serves 1B+ MAU via Meta AI",pos:"Open-source leader"},{name:"Meta AI assistant",desc:"In FB/IG/WhatsApp/Glasses · 700M+ MAU target",pos:"Flagship AI consumer"},{name:"MTIA (custom AI silicon)",desc:"Inference ASIC · 2nd-gen shipping via AVGO · scaling",pos:"Silicon bet"},{name:"Ray-Ban Meta Smart Glasses",desc:"Partner w/ EssilorLuxottica · 5M+ sold · follow-up launching",pos:"Consumer AR"},{name:"Orion AR prototype",desc:"Full AR glasses · not yet for sale · 2027+ timeline",pos:"Strategic bet"},{name:"Quest 3/3S",desc:"VR HMD · struggling consumer segment",pos:"VR presence"},{name:"Facebook/Instagram/WhatsApp/Threads",desc:"Family of Apps · 3.2B DAP",pos:"Ad platform"}], cp:["GOOG (YouTube)","TikTok/ByteDance (pvt)","MSFT","AAPL (Vision Pro)","Snap"], ops:{hq:"Menlo Park, CA",fd:2004,emp:72000,ne:"Late Apr 2026"}, own:{insider:13,institutional:62} },

  { t:"AMKR", themes:["ai"], cc:"🇺🇸", nm:"Amkor Technology", v:"compute", s:"Packaging", r:6300, g:16, mc:15382, pe:18, pr:"CoWoS advanced packaging", d:"Second-largest OSAT for advanced packaging. Key CoWoS partner alongside TSMC. Building $2B Arizona facility for US-based AI chip packaging.", ri:["TSMC dependency","Cyclical"], ca:["CoWoS capacity expansion","Arizona facility"], dc:{f:600,gr:12,w:10,tg:2,sh:245}, ms:{ta:.5,ch:.3,ai:.9,ra:.3}, fin:{beta:1.4,eps:1.95,div:.22,rg:[5,8,12,18,25]}, rs:[["Communications (mobile)",48],["Computing",25],["Automotive/Industrial/Other",17],["Consumer",10]], geo:[["Taiwan/Korea (sites)",65],["US",15],["China",10],["Other Asia",10]], tc:[["Qualcomm",18],["Apple (indirect)",12],["NVIDIA",10],["MediaTek",8],["AMD",7],["Other fabless",45]], pl:[{name:"2.5D advanced packaging",desc:"CoWoS alternative · FO-PLP · AI GPU packaging",pos:"TSM competitor"},{name:"TSMC OSAT relationship",desc:"Complementary to CoWoS for secondary packaging",pos:"Strategic"},{name:"Arizona facility (2025)",desc:"Apple anchor · Glendale · US CHIPS Act funded",pos:"US footprint"},{name:"SiP (System-in-Package)",desc:"Wireless/IoT/wearables",pos:"Franchise"},{name:"Flip chip BGA",desc:"Traditional packaging",pos:"Core"}], cp:["ASE Group (Taiwan)","SPIL","JCET (China)","TSMC (IDM)"], ops:{hq:"Tempe, AZ",fd:1968,emp:32000,ne:"Late Apr 2026"}, own:{insider:48,institutional:45} },
  { t:"DELL", themes:["ai"], cc:"🇺🇸", nm:"Dell Technologies", v:"compute", s:"Systems", r:95600, g:23, mc:134260, pe:21, pr:"PowerEdge AI servers + storage", d:"Leading AI server OEM. CoreWeave's primary infrastructure partner for Blackwell Ultra deployments. Enterprise AI server market leader alongside HPE.", ri:["Thin server margins","Consumer PC drag"], ca:["AI server revenue growing 50%+","CoreWeave partnership"], dc:{f:6500,gr:10,w:9,tg:2,sh:700}, ms:{ta:.3,ch:.2,ai:.85,ra:.3}, fin:{beta:1.1,eps:7.50,div:1.78,rg:[3,5,8,12,18]}, rs:[["Infrastructure Solutions Group (servers+storage)",50],["Client Solutions Group (PCs)",47],["Other",3]], geo:[["Americas",55],["EMEA",26],["APAC",19]], tc:[["Hyperscalers (AI server tier)",22],["Large enterprise",35],["Mid-market",22],["Federal/govt",11],["Consumer/SMB",10]], pl:[{name:"PowerEdge XE9680 / XE9712",desc:"Blackwell / GB200 rack · flagship AI server",pos:"Leading AI OEM"},{name:"PowerEdge mainstream",desc:"Intel Xeon + AMD EPYC servers",pos:"Franchise"},{name:"PowerStore / PowerMax",desc:"Enterprise storage",pos:"Cash cow"},{name:"Commercial PCs",desc:"Latitude / Precision · business PC share",pos:"Mature"},{name:"APEX subscription",desc:"Consumption cloud-like sub",pos:"New model"}], cp:["HPE","SMCI","Lenovo","IBM","Cisco (servers)"], ops:{hq:"Round Rock, TX",fd:1984,emp:108000,ne:"Late May 2026"}, own:{insider:45,institutional:40} },
  { t:"SMCI", themes:["ai"], cc:"🇺🇸", nm:"Super Micro Computer", v:"compute", s:"Systems", r:18000, g:12, mc:16797, pe:15, pr:"GPU-optimized AI server racks", d:"Fastest-growing AI server maker. NVIDIA reference design partner. Liquid-cooled rack-scale solutions for GB200 NVL72. Accounting issues resolved.", ri:["Accounting restatement history","Low margins"], ca:["Direct liquid cooling leadership","NVIDIA reference partner"], dc:{f:1200,gr:30,w:12,tg:2,sh:590}, ms:{ta:.3,ch:.2,ai:.95,ra:.3}, fin:{beta:2.0,eps:1.80,div:0,rg:[15,40,80,100,60]}, rs:[["Server & Storage Systems",96],["Subsystems/Accessories",4]], geo:[["US",55],["Asia",32],["Europe",13]], tc:[["Hyperscalers",18],["Neoclouds (CoreWeave/Lambda/etc.)",22],["Enterprise AI",32],["Data center integrators",18],["Other",10]], pl:[{name:"GB200 NVL72 rack",desc:"Blackwell rack-scale · earliest volume supplier",pos:"AI server leader"},{name:"Liquid cooling platforms",desc:"In-house DLC technology · 30% AI rack share claim",pos:"Key differentiator"},{name:"Building Block Server arch",desc:"Modular + customizable · faster config cycle vs tier-1",pos:"Speed advantage"},{name:"AMD MI355X / MI400 racks",desc:"Broader AI accelerator support",pos:"Diversification"},{name:"AS-1115HS-TNR",desc:"Single-node server franchise",pos:"Mainstream"}], cp:["DELL","HPE","Lenovo","ASUS","Inventec (pvt)","Quanta (pvt)"], ops:{hq:"San Jose, CA",fd:1993,emp:6200,ne:"Mid May 2026"}, own:{insider:17,institutional:60} },
  { t:"CLS", themes:["ai"], cc:"🇨🇦", nm:"Celestica Inc", v:"compute", s:"Systems", r:10800, g:12, mc:45156, pe:28, pr:"AI networking + server hardware", d:"Contract manufacturer for hyperscaler networking and server hardware. 2026 revenue guidance raised to $17B (+37% YoY). AI/ML segment is 70%+ of revenue.", ri:["Customer concentration"], ca:["$17B 2026 revenue guidance","AI hardware demand surge"], dc:{f:800,gr:35,w:11,tg:2,sh:118}, ms:{ta:.3,ch:.2,ai:.9,ra:.3}, fin:{beta:1.5,eps:6.05,div:0,rg:[10,18,30,40,37]}, rs:[["Connectivity & Cloud Solutions (CCS - hyperscale)",65],["Advanced Technology Solutions (ATS - industrial+aero)",35]], geo:[["Asia (mfg)",55],["Americas",30],["Europe",15]], tc:[["Hyperscaler #1 (likely Meta + MS)",38],["Hyperscaler #2",22],["Industrial OEMs",18],["Aerospace/medical",12],["Other",10]], pl:[{name:"Hyperscale ODM manufacturing",desc:"Custom AI racks · Meta + MS anchors · 70%+ of revenue",pos:"Tier-1 HPC ODM"},{name:"400G/800G networking systems",desc:"Switches + DCI systems",pos:"Core"},{name:"Immersion + liquid cooling",desc:"Advanced cooling for AI racks",pos:"Differentiator"},{name:"ATS (aerospace + medical + industrial)",desc:"Diversified high-mix contract mfg",pos:"Stabilizer"}], cp:["Flex","Jabil","Foxconn / Hon Hai","Wistron (pvt)","Quanta (pvt)"], ops:{hq:"Toronto, ON, Canada",fd:1994,emp:30000,ne:"Late Apr 2026"}, own:{insider:.3,institutional:78} },
  { t:"APH", themes:["ai"], cc:"🇺🇸", nm:"Amphenol Corporation", v:"networking", s:"Interconnect", r:17000, g:34, mc:178778, pe:38, pr:"High-speed AI rack connectors + cables", d:"Connectors and cables inside every AI rack. Revenue $21B+ with 33% gross margins. Supplies NVIDIA, Dell, SMCI, and all major DC operators.", ri:["Premium valuation at 42x P/E"], ca:["AI rack density driving connector content growth","$180B+ market cap"], dc:{f:5000,gr:15,w:9,tg:3,sh:1210}, ms:{ta:.3,ch:.1,ai:.85,ra:.3}, fin:{beta:1.1,eps:3.55,div:.60,rg:[8,12,18,25,30]}, rs:[["Communications Solutions",55],["Harsh Environment Solutions",25],["Interconnect & Sensor Systems",20]], geo:[["North America",40],["China",20],["Europe",22],["Other Asia",18]], tc:[["Hyperscalers (AI)",18],["Industrial",22],["Automotive",17],["Mil/aero",15],["Comms/Broadband",15],["Other",13]], pl:[{name:"High-speed I/O connectors",desc:"PCIe 6 · 224G copper backplane · 1.6T QSFP-DD",pos:"AI server leader"},{name:"Power interconnects",desc:"Busway + rack power distribution · AI density",pos:"Power-density play"},{name:"Fiber optic connectors",desc:"LC + MPO-16 · 800G / 1.6T patch",pos:"Franchise"},{name:"CIT (Industrial)",desc:"Automation + factory",pos:"Diversifier"},{name:"Mobile device antennas",desc:"Base-station + smartphone RF",pos:"Scale business"}], cp:["TEL Connectivity","Molex (Koch)","Corning (GLW optics)","Yazaki (pvt)"], ops:{hq:"Wallingford, CT",fd:1932,emp:95000,ne:"Late Apr 2026"}, own:{insider:.2,institutional:85} },
  { t:"GLW", themes:["ai"], cc:"🇺🇸", nm:"Corning Incorporated", v:"networking", s:"Interconnect", r:14000, g:37, mc:141100, pe:28, pr:"Optical fiber + specialty glass", d:"World's largest optical fiber manufacturer. Critical DC interconnect infrastructure. Specialty glass for semiconductor manufacturing. 170+ years old.", ri:["Cyclical display glass segment"], ca:["AI datacenter fiber demand surge","Specialty materials growth"], dc:{f:2200,gr:8,w:9,tg:2,sh:860}, ms:{ta:.2,ch:.2,ai:.7,ra:.4}, fin:{beta:1.2,eps:1.95,div:.56,rg:[0,3,5,10,15]}, rs:[["Optical Communications",33],["Display Technologies",23],["Specialty Materials (Gorilla Glass)",17],["Environmental Tech",14],["Life Sciences",13]], geo:[["Americas",34],["APAC",42],["Europe",24]], tc:[["Apple (Gorilla Glass)",16],["Samsung (display glass)",10],["Data centers (optical)",22],["Auto OEMs (substrate)",14],["Life sciences",11],["Other",27]], pl:[{name:"Optical Fiber (Gen AI)",desc:"Ultra-dense multi-core fiber · AI DC interconnect surge",pos:"Leader · capacity-bound"},{name:"Gorilla Glass (Armor/Victus)",desc:"Smartphone cover glass · Apple anchor",pos:"Franchise"},{name:"Bendable Auto Glass",desc:"Curved in-car display · EV premium",pos:"Growth"},{name:"DRAM / Semi glass substrates",desc:"Advanced packaging glass · HBM/GPU",pos:"Emerging"},{name:"Valor Glass pharma vials",desc:"COVID vaccine legacy · BioManufacturing",pos:"Niche"}], cp:["Asahi Glass","Nippon Electric Glass","Schott","CommScope (fiber)"], ops:{hq:"Corning, NY",fd:1851,emp:60000,ne:"Late Apr 2026"}, own:{insider:.3,institutional:77} },
  { t:"IRM", themes:["ai"], cc:"🇺🇸", nm:"Iron Mountain", v:"dcInfra", s:"REIT", r:6300, g:60, mc:34465, pe:60, pr:"Data center REIT + records mgmt", d:"Global REIT aggressively expanding into data centers from records management roots. Building AI-ready campuses. 100+ MW pipeline.", ri:["High valuation premium","Transition risk"], ca:["DC expansion pipeline","Land bank for AI campuses"], dc:{f:1800,gr:10,w:7,tg:2,sh:295}, ms:{ta:.2,ch:.1,ai:.75,ra:.6}, fin:{beta:.8,eps:1.68,div:2.74,rg:[3,5,8,12,15]}, rs:[["Storage (records + data)",62],["Digital Solutions",16],["Data Centers",12],["Asset Lifecycle Mgmt (ITAD)",10]], geo:[["US",64],["Europe",16],["Other Americas",10],["APAC",10]], tc:[["Enterprise F500",55],["Federal/govt",18],["SMB",12],["Cloud/hyperscalers (DC)",15]], pl:[{name:"Data Center Development",desc:"Northern VA + London + Phoenix · Hyperscale leasing",pos:"Fastest-growing segment"},{name:"Records Management",desc:"~240M cubic ft storage · GPC recurring",pos:"Cash cow"},{name:"ITAD (Asset Lifecycle)",desc:"Enterprise tech decommissioning · growing",pos:"Growth"},{name:"Digital Solutions",desc:"Content services + archiving SaaS",pos:"Emerging"},{name:"Entertainment storage",desc:"Film/media preservation",pos:"Niche"}], cp:["EQIX","DLR","Switch (pvt)","Recall (pvt)"], ops:{hq:"Portsmouth, NH",fd:1951,emp:28000,ne:"Early May 2026"}, own:{insider:.3,institutional:83} },
  { t:"APLD", themes:["ai","crypto"], cc:"🇺🇸", nm:"Applied Digital", v:"dcInfra", s:"AI Hosting", r:300, g:15, mc:7469, pe:null, pr:"Purpose-built AI data centers", d:"Pure-play AI datacenter builder. Purpose-built GPU facilities with direct liquid cooling. Backed by $5B Macquarie facility. Serving hyperscalers and AI companies.", ri:["Pre-profitable","Capital intensive"], ca:["$5B Macquarie backing","Purpose-built AI DC design"], dc:{f:-50,gr:80,w:15,tg:2,sh:250}, ms:{ta:.2,ch:.1,ai:.95,ra:.7}, fin:{beta:2.5,eps:-.35,div:0,rg:[-20,50,150,200,250]}, rs:[["HPC (AI GPU Hosting)",60],["Cloud Services (self)",25],["BTC Hosting",15]], geo:[["US (ND + TX)",100]], tc:[["CoreWeave (anchor AI tenant)",55],["Other AI cloud tenants",25],["BTC miners (third-party)",15],["Self-mining (minor)",5]], pl:[{name:"Polaris Forge 2 (Ellendale ND)",desc:"400 MW · CoreWeave 15-yr lease · flagship",pos:"Crown asset"},{name:"Garden City TX",desc:"180 MW HPC development",pos:"Next scale"},{name:"Cloud Services (legacy)",desc:"GPU-as-a-service · being de-prioritized",pos:"Winding down"},{name:"Macquarie $5B financing",desc:"Project-level debt financing · Sept 2024",pos:"Capital source"}], cp:["IREN","CIFR","WULF","CoreWeave (customer/peer)"], ops:{hq:"Dallas, TX",fd:2001,emp:210,ne:"May 2026"}, own:{insider:5,institutional:55} },
  { t:"CORZ", themes:["ai","crypto"], cc:"🇺🇸", nm:"Core Scientific", v:"dcInfra", s:"AI Hosting", r:800, g:50, mc:5744, pe:30, pr:"Bitcoin-to-AI datacenter conversion", d:"Converting bitcoin mining facilities to AI GPU hosting. 200MW CoreWeave hosting deal worth $3.5B over 12 years. Owns power infrastructure and land.", ri:["Crypto legacy","Customer concentration"], ca:["200MW CoreWeave deal","Owned power + land assets"], dc:{f:-100,gr:60,w:14,tg:2,sh:300}, ms:{ta:.2,ch:.1,ai:.9,ra:.5}, fin:{beta:2.0,eps:-.40,div:0,rg:[-30,20,80,120,150]}, rs:[["HPC/AI Hosting",45],["BTC Self-Mining",30],["BTC Hosting (third-party)",25]], geo:[["US (TX, ND, GA, KY, NC)",100]], tc:[["CoreWeave (12-yr $17.9B lease)",55],["Self-mining BTC",25],["Third-party hosting",18],["Other",2]], pl:[{name:"CoreWeave Denton TX",desc:"500 MW HPC datacenter · 12-yr $17.9B lease · Apr 2025",pos:"Mega contract"},{name:"Muskogee OK",desc:"Second flagship HPC site · ~300 MW target",pos:"Expansion"},{name:"Self-mining fleet",desc:"~1.3 GW · diversified across 5 states",pos:"Heritage"},{name:"Post-Ch 11 emergence (Jan 2024)",desc:"Restructured balance sheet",pos:"Turnaround"}], cp:["IREN","CIFR","WULF","APLD","HUT"], ops:{hq:"Austin, TX",fd:2017,emp:600,ne:"May 2026"}, own:{insider:15,institutional:48} },

  { t:"CRDO", themes:["ai"], cc:"🇺🇸", nm:"Credo Technology", v:"photonics", s:"DSP", r:900, g:55, mc:27687, pe:60, pr:"High-speed SerDes + connectivity ASICs", d:"Innovator in high-speed connectivity for AI infrastructure. Acquiring DustPhotonics for SiPh capability. SerDes IP and DSPs for 800G/1.6T optical and electrical interconnects.", ri:["60x P/E premium","DustPhotonics integration risk"], ca:["DustPhotonics SiPh acquisition","Vertically integrated connectivity stack"], dc:{f:150,gr:45,w:12,tg:3,sh:175}, ms:{ta:.3,ch:.2,ai:.9,ra:.3}, fin:{beta:1.8,eps:1.45,div:0,rg:[20,35,55,70,90]}, rs:[["Products (AECs, DSPs, SerDes)",90],["IP Licensing",10]], geo:[["US (hyperscalers)",65],["Asia (ODM/CM mfg)",30],["Other",5]], tc:[["Amazon",28],["Microsoft",22],["Meta",12],["Google/other cloud",10],["ODMs/CMs",18],["Other",10]], pl:[{name:"HiWire Active Electrical Cables (AECs)",desc:"Top-of-rack AI fabric · copper replacement for fiber · 800G",pos:"Category leader"},{name:"Optical DSPs",desc:"100G/200G/400G/800G PAM4 · transceiver DSPs",pos:"Growth"},{name:"SerDes IP",desc:"High-speed IP licensing · Chiplet interconnects",pos:"Foundation"},{name:"PCIe Retimer",desc:"Newer entry vs ALAB Aries · ramping",pos:"Adjacent"},{name:"Line Card PHY",desc:"Merchant silicon for line cards",pos:"Legacy"}], cp:["MRVL","AVGO","ALAB","Macom","Spectra7"], ops:{hq:"San Jose, CA",fd:2008,emp:700,ne:"Early June 2026"}, own:{insider:3,institutional:55} },
  { t:"GFS", themes:["ai"], cc:"🇺🇸", nm:"GlobalFoundries", v:"photonics", s:"Foundry", r:6800, g:29, mc:27733, pe:28, pr:"Specialty SiPh foundry + RF/analog fab", d:"Second-largest specialty foundry. Silicon photonics revenue doubling in 2026. $16B US manufacturing investment. Suing Tower Semi over patents. Only US-based SiPh alternative to TSMC.", ri:["Litigation with Tower Semi","No leading-edge nodes"], ca:["SiPh revenue doubling 2026","$1B SiPh target by 2028"], dc:{f:1200,gr:8,w:9,tg:2,sh:556}, ms:{ta:.4,ch:.1,ai:.8,ra:.3}, fin:{beta:1.2,eps:1.72,div:0,rg:[-5,0,1,5,10]}, rs:[["Mobile",44],["Communications Infrastructure + Data Center",28],["Auto",16],["Home & Industrial",12]], geo:[["US",35],["Europe",25],["Korea/Taiwan/China",30],["Other",10]], tc:[["Qualcomm",20],["AMD",12],["Apple (via Qualcomm)",10],["NXPI",7],["Other auto/industrial",30],["Communications",21]], pl:[{name:"FDX 22 / 12 / 8 (FD-SOI)",desc:"Differentiated FD-SOI nodes · auto + low-power",pos:"Technology moat"},{name:"RF-SOI (8SW)",desc:"RF front-end for 5G smartphones",pos:"Category leader"},{name:"Silicon photonics (Malta)",desc:"AI optical transceiver substrates",pos:"AI adjacency"},{name:"28-40nm logic",desc:"Mainstream IoT/consumer",pos:"Core"},{name:"Malta + Dresden + Burlington capacity",desc:"US CHIPS Act anchor · $30B total capex planned",pos:"Expansion"}], cp:["TSM (leading edge)","Samsung Foundry","UMC","SMIC","Intel Foundry"], ops:{hq:"Malta, NY",fd:2009,emp:13000,ne:"Early May 2026"}, own:{insider:88,institutional:10} },
  { t:"IPGP", themes:["ai"], cc:"🇺🇸", nm:"IPG Photonics", v:"photonics", s:"Lasers", r:1050, g:40, mc:4988, pe:35, pr:"High-power fiber lasers", d:"World's largest fiber laser manufacturer. Dominant in industrial laser market, increasingly supplying telecom and datacenter applications. Vertically integrated from diodes to complete systems.", ri:["Industrial cyclicality","China competition"], ca:["Datacenter fiber laser demand","Vertical integration advantage"], dc:{f:120,gr:10,w:10,tg:2,sh:42}, ms:{ta:.4,ch:.5,ai:.6,ra:.4}, fin:{beta:1.3,eps:3.40,div:0,rg:[-10,-5,3,8,12]} },
  { t:"ONTO", themes:["ai"], cc:"🇺🇸", nm:"Onto Innovation", v:"photonics", s:"Test", r:1000, g:55, mc:13366, pe:30, pr:"Process control + semiconductor inspection", d:"Advanced semiconductor process control, lithography, and inspection equipment. Critical for ensuring yield in SiPh and advanced packaging. Serves all major foundries.", ri:["Cyclical capex spending"], ca:["Advanced packaging inspection growth","SiPh process control"], dc:{f:250,gr:15,w:10,tg:3,sh:50}, ms:{ta:.3,ch:.2,ai:.8,ra:.3}, fin:{beta:1.4,eps:5.30,div:0,rg:[5,10,15,20,25]}, rs:[["Process Control Systems",85],["Services",15]], geo:[["Taiwan",30],["Korea",20],["China",18],["US",15],["Other Asia",12],["Europe",5]], tc:[["TSMC",20],["Samsung",14],["Micron",11],["Intel",9],["Memory (SK/CXMT)",20],["Other",26]], pl:[{name:"Dragonfly platform",desc:"Advanced packaging inspection · HBM stack metrology",pos:"AI packaging winner"},{name:"Iris in-line metrology",desc:"Back-end packaging inspection · HBM critical",pos:"Growth"},{name:"Atlas V film metrology",desc:"Film thickness + OCD",pos:"Franchise"},{name:"Firefly macro inspection",desc:"Wafer-level defect detection",pos:"Core"}], cp:["KLAC","Nova","Camtek","Rudolph (legacy)"], ops:{hq:"Wilmington, MA",fd:2019,emp:1600,ne:"Early May 2026"}, own:{insider:1,institutional:98} },
  { t:"VIAV", themes:["ai"], cc:"🇺🇸", nm:"Viavi Solutions", v:"photonics", s:"Test", r:1000, g:58, mc:9148, pe:20, pr:"Network test & measurement", d:"Network test and measurement equipment. Validates that 800G/1.6T optical links meet spec. Every datacenter deployment requires Viavi test gear for certification.", ri:["Telecom spending cycles"], ca:["800G/1.6T test equipment demand","Required for every DC deployment"], dc:{f:100,gr:5,w:10,tg:2,sh:220}, ms:{ta:.2,ch:.2,ai:.75,ra:.3}, fin:{beta:1.1,eps:.45,div:0,rg:[-8,-3,2,5,8]} },
  { t:"SKYT", themes:["ai","quantum"], cc:"🇺🇸", nm:"SkyWater Technology", v:"photonics", s:"Foundry", r:320, g:20, mc:1684, pe:null, pr:"US-domestic specialty foundry", d:"Only fully US-owned and operated semiconductor foundry. CHIPS Act recipient. Specialty processes for photonics, rad-hard, and MEMS. Strategic national security asset.", ri:["Small scale","Pre-profitable"], ca:["CHIPS Act funding","Only US-domestic foundry option","National security premium"], dc:{f:-20,gr:25,w:15,tg:2,sh:52}, ms:{ta:.1,ch:.05,ai:.6,ra:.3}, fin:{beta:2.0,eps:-.40,div:0,rg:[-5,10,20,30,40]} },
  { t:"LPTH", themes:["ai"], cc:"🇺🇸", nm:"LightPath Technologies", v:"photonics", s:"CPO", r:40, g:35, mc:421, pe:null, pr:"Infrared optics + optical assemblies", d:"Designs and manufactures precision optical components and assemblies for infrared, visible, and near-infrared applications. Serves defense, industrial, and telecom markets.", ri:["Micro-cap","Limited liquidity"], ca:["Defense IR optics demand","Telecom optical assembly growth"], dc:{f:-3,gr:15,w:18,tg:2,sh:30}, ms:{ta:.2,ch:.1,ai:.4,ra:.3}, fin:{beta:1.5,eps:-.10,div:0,rg:[-5,5,10,15,20]} },
  { t:"HIMX", themes:["ai"], cc:"🇹🇼", nm:"Himax Technologies", v:"photonics", s:"CPO", r:900, g:30, mc:1942, pe:10, pr:"Display drivers + WLO optical components", d:"Display driver ICs and wafer-level optics for AR/VR and sensing. Wafer-level optics technology increasingly relevant for photonic integration and structured light.", ri:["Consumer display cyclicality","China exposure"], ca:["Wafer-level optics for photonics","AR/VR growth"], dc:{f:80,gr:8,w:11,tg:2,sh:174}, ms:{ta:.5,ch:.6,ai:.5,ra:.4}, fin:{beta:1.4,eps:.85,div:.20,rg:[-15,-5,5,10,15]} },
  { t:"FRMI", themes:["ai"], cc:"🇺🇸", nm:"Fermi Inc", v:"dcInfra", s:"AI Hosting", r:0, g:0, mc:4010, pe:null, pr:"11 GW HyperGrid private power campus", d:"Pre-revenue AI data center REIT building the world's largest private power campus in Amarillo, TX. 7,570 acres with 6 of 17 GW already permitted. Co-founded by former Energy Secretary Rick Perry. Backed by $700M+ from MUFG.", ri:["Pre-revenue with $0 operating history","$50-70B total capital required","No firm tenant contracts (only LOIs)"], ca:["1.1 GW Phase 1 target by end 2026","$1.5B annualized lease potential","Grid-independent behind-the-meter power"], dc:{f:-50,gr:100,w:18,tg:3,sh:631}, ms:{ta:.1,ch:.05,ai:.95,ra:.7}, fin:{beta:0.35,eps:-.02,div:0,rg:[0,0,0,0,500]} },
  { t:"LASR", themes:["ai","defense"], cc:"🇺🇸", nm:"nLIGHT Inc", v:"photonics", s:"Lasers", r:300, g:30, mc:2200, pe:null, pr:"High-power semiconductor lasers", d:"High-power semiconductor and fiber laser maker. Defense directed energy plus growing AI datacenter applications. Stock surged 16% on NVIDIA photonics investment news.", ri:["Defense contract concentration","Small scale vs LITE/COHR"], ca:["AI datacenter laser demand","Directed energy defense growth"], dc:{f:-15,gr:20,w:14,tg:2,sh:45}, ms:{ta:.3,ch:.2,ai:.6,ra:.3,bg:.8,cf:.6,ex:.3}, fin:{beta:1.8,eps:-.30,div:0,rg:[-15,-5,5,15,25]} },
  { t:"ALAB", themes:["ai"], cc:"🇺🇸", nm:"Astera Labs", v:"networking", s:"Interconnect", r:1100, g:72, mc:22000, pe:80, pr:"PCIe retimers + Scorpio fabric switches", d:"Intelligent connectivity for AI infrastructure. PCIe 6 retimers and Scorpio fabric switches inside every major GPU rack. Revenue $1.1B with 72% gross margins. Aries PCIe retimer portfolio grew 70% YoY.", ri:["80x P/E premium valuation","Customer concentration in hyperscalers"], ca:["PCIe Gen6 retimer ramp","Scorpio switching platform growth","Every GPU rack needs connectivity ICs"], dc:{f:250,gr:35,w:12,tg:3,sh:160}, ms:{ta:.3,ch:.2,ai:.95,ra:.3}, fin:{beta:2.0,eps:1.70,div:0,rg:[30,50,70,80,65]}, rs:[["Aries (PCIe retimers)",62],["Scorpio (AI backplane)",20],["Taurus (CXL)",10],["Leo (CXL Memory)",8]], geo:[["US (hyperscalers)",68],["Asia (ODM mfg)",28],["Other",4]], tc:[["Microsoft",22],["Meta",18],["Google",15],["Oracle",12],["Amazon",10],["Other hyperscalers/ODMs",23]], pl:[{name:"Aries PCIe 6 Retimers",desc:"AI server signal integrity · critical for GB200 racks",pos:"Dominant share"},{name:"Scorpio P-Series Switch",desc:"PCIe fabric for GPU-to-GPU · Blackwell-era AI pods",pos:"Growth vector"},{name:"Scorpio X-Series",desc:"Scale-up accelerator interconnect · UALink-compatible",pos:"Strategic"},{name:"Taurus Ethernet SmartCable",desc:"AEC with embedded DSP · 800G backplanes",pos:"Niche"},{name:"Leo CXL Memory",desc:"CXL 3.0 memory expansion · early adopter phase",pos:"Emerging"}], cp:["MRVL","AVGO","Microchip","Parade","Kandou"], ops:{hq:"Santa Clara, CA",fd:2017,emp:400,ne:"Early May 2026"}, own:{insider:35,institutional:55} },

  /* ═══════════════ DEFENSE PRIMES ═══════════════ */
  { t:"LMT", themes:["defense","drones","space"], cc:"🇺🇸", nm:"Lockheed Martin", v:"primes", s:"Air", r:74000, g:12, mc:110000, pe:17, pr:"F-35 · Missiles · Space · Sikorsky", d:"World's largest defense contractor. F-35 program, PAC-3 missiles, Sikorsky helicopters, space systems. Record backlog of $165B+. Direct beneficiary of allied rearmament cycle.", ri:["F-35 sustainment cost overruns","Single-platform dependency"], ca:["$165B backlog","Replenishment of Ukraine stockpiles","Golden Dome missile defense"], dc:{f:6000,gr:5,w:8,tg:2,sh:230}, ms:{bg:.95,cf:.9,ex:.9,ra:.4}, fin:{beta:.5,eps:27.50,div:13.20,rg:[3,5,5,6,8]}, rs:[["Aeronautics (F-35, F-16, etc.)",40],["Missiles & Fire Control",18],["Rotary & Mission Systems",25],["Space",17]], geo:[["US DoD",65],["Intl/FMS",28],["Commercial/Other",7]], tc:[["US DoD",72],["NATO Allies (FMS)",15],["Non-NATO Allies",8],["Commercial/NASA",5]], pl:[{name:"F-35 Lightning II",desc:"5th-gen stealth fighter · 3 variants · 990 delivered",pos:"Sole-source"},{name:"PAC-3/MSE",desc:"Hit-to-kill missile defense interceptor · Ukraine ramp",pos:"Capacity constrained"},{name:"THAAD",desc:"Terminal High-Altitude Area Defense",pos:"Active FMS"},{name:"Sikorsky Black Hawk",desc:"UH-60 · H-60 Army utility helicopter",pos:"Franchise"},{name:"Skunk Works NGAD",desc:"6th-gen fighter · classified",pos:"Competition"},{name:"Space (ULA, satellites)",desc:"Trident II · GPS III · Orion",pos:"Diversified"}], cp:["NOC","RTX","GD","BA","HII","BAESY","RNMBY"], ops:{hq:"Bethesda, MD",fd:1995,emp:122000,bl:{label:"Backlog",val:176,unit:"B"},ne:"Late Apr 2026"}, own:{insider:.1,institutional:75} },
  { t:"NOC", themes:["defense","drones","space"], cc:"🇺🇸", nm:"Northrop Grumman", v:"primes", s:"Air", r:42000, g:12, mc:88000, pe:19, pr:"B-21 · Sentinel ICBM · Space · Classified", d:"Prime on B-21 Raider stealth bomber and Sentinel ICBM program. Heavy classified and space work. Beneficiary of strategic nuclear modernization and long-range strike investment.", ri:["Sentinel program cost growth","Heavy classified disclosure limits"], ca:["B-21 low-rate production ramp","Sentinel full rate","Space segment doubling"], dc:{f:3200,gr:6,w:8,tg:2,sh:148}, ms:{bg:.95,cf:.85,ex:.4,ra:.4}, fin:{beta:.5,eps:26.00,div:8.20,rg:[4,5,6,7,8]}, rs:[["Space Systems",30],["Mission Systems",25],["Aeronautics (B-21, classified)",28],["Defense Systems",17]], geo:[["US DoD",77],["International allies (FMS)",18],["Commercial/NASA",5]], tc:[["US Air Force",35],["US Space Force",20],["US Army/Navy",22],["FMS Allies",18],["Other",5]], pl:[{name:"B-21 Raider",desc:"6th-gen stealth bomber · LRIP ramp 2025-2027",pos:"Sole-source"},{name:"Sentinel ICBM",desc:"GBSD · 400-missile replacement · over budget",pos:"Program under review"},{name:"Triton MQ-4C",desc:"High-altitude long-endurance maritime UAV",pos:"Franchise"},{name:"Next Gen Interceptor",desc:"NGI homeland missile defense",pos:"Development"},{name:"James Webb legacy",desc:"Optics · classified space payloads",pos:"Space premium"},{name:"Pulsar soldier ECM",desc:"EW backpack systems",pos:"Growth"}], cp:["LMT","RTX","GD","BA","BAESY","RNMBY","CW"], ops:{hq:"Falls Church, VA",fd:1994,emp:97000,bl:{label:"Backlog",val:92,unit:"B"},ne:"Apr 2026"}, own:{insider:.1,institutional:83} },
  { t:"RTX", themes:["defense","drones","quantum"], cc:"🇺🇸", nm:"RTX Corporation", v:"missiles", s:"Missiles", r:85000, g:20, mc:170000, pe:22, pr:"Patriot · Stinger · Pratt engines · Collins avionics", d:"Post-merger defense + commercial aerospace giant. Raytheon missiles (Patriot, Stinger, AIM-9X, LRSO), Pratt & Whitney engines, Collins avionics. Replenishment demand surging.", ri:["GTF engine powder-metal recall","Commercial aerospace cycle"], ca:["Patriot/PAC-3 surge orders","Ukraine / Israel replenishment","GTF aftermarket tailwind"], dc:{f:7500,gr:6,w:8,tg:2,sh:1330}, ms:{bg:.85,cf:.95,ex:.85,ra:.4}, fin:{beta:.9,eps:5.80,div:2.70,rg:[4,6,7,8,9]}, rs:[["Raytheon (Defense)",42],["Collins Aerospace",30],["Pratt & Whitney",28]], geo:[["US",60],["Europe",18],["APAC",12],["ROW",10]], tc:[["US DoD",30],["Airbus/Boeing/OEM",28],["Airlines (aftermarket)",22],["FMS Allies",18],["Other",2]], pl:[{name:"Patriot PAC-3 MSE",desc:"LMT partner interceptor · Ukraine/Israel ramp",pos:"Capacity-bound"},{name:"GTF PW1100G/PW1500G",desc:"A320neo/A220 engines · powder-metal recall",pos:"Aftermarket tailwind"},{name:"AIM-120 AMRAAM / AIM-9X",desc:"Air-to-air missiles",pos:"Franchise"},{name:"Tomahawk",desc:"Long-range cruise missile",pos:"Replenishment"},{name:"Collins Avionics",desc:"Cockpit/flight controls · ProLine Fusion",pos:"Commercial leader"},{name:"LRSO",desc:"Long-range standoff missile",pos:"Development"}], cp:["LMT","NOC","GD","BA","GE Aerospace","SAF","BAESY"], ops:{hq:"Arlington, VA",fd:2020,emp:185000,bl:{label:"Backlog",val:221,unit:"B"},ne:"Apr 2026"}, own:{insider:.1,institutional:82} },
  { t:"GD", themes:["defense","space","drones"], cc:"🇺🇸", nm:"General Dynamics", v:"primes", s:"Land", r:51000, g:15, mc:83000, pe:20, pr:"Abrams · Virginia-class subs · Gulfstream · IT", d:"Four-segment platform: Combat Systems (Abrams, Stryker), Marine (Virginia subs, Columbia SSBN), Technologies (IT), Gulfstream (bizjets). Submarine backlog drives multi-decade visibility.", ri:["Gulfstream order cyclicality","Submarine shipbuilder labor constraints"], ca:["Columbia-class full-rate","G700 deliveries","International armor orders"], dc:{f:4000,gr:6,w:8,tg:2,sh:275}, ms:{bg:.85,cf:.7,ex:.7,ra:.4}, fin:{beta:.8,eps:14.50,div:5.80,rg:[3,5,8,8,9]}, rs:[["Aerospace (Gulfstream)",30],["Marine Systems",28],["Technologies (IT/Mission)",24],["Combat Systems",18]], geo:[["US",73],["International",27]], tc:[["US Navy",28],["US Army",12],["Gulfstream civilian",25],["FMS Allies",15],["US Air Force/Intel",13],["Other",7]], pl:[{name:"Virginia-class SSN",desc:"Attack subs · Electric Boat · 2/yr ramp",pos:"Duopoly w/ HII"},{name:"Columbia-class SSBN",desc:"Ballistic submarines · fleet replacement",pos:"Multi-decade"},{name:"Gulfstream G700/G800",desc:"Ultra-long-range bizjet",pos:"#2 premium biz"},{name:"Abrams Main Battle Tank",desc:"M1A2 SEP v3 · FMS surge",pos:"Land primacy"},{name:"Stryker IFV",desc:"ICV/Dragoon variants",pos:"Franchise"},{name:"IT / Mission Systems",desc:"Gidep · ICAM · defense IT",pos:"Services"}], cp:["LMT","NOC","HII","BA","RTX","TXT","DASSY"], ops:{hq:"Reston, VA",fd:1952,emp:117000,bl:{label:"Backlog",val:103,unit:"B"},ne:"Apr 2026"}, own:{insider:.1,institutional:89} },
  { t:"BA", themes:["defense","space","drones"], cc:"🇺🇸", nm:"Boeing", v:"primes", s:"Air", r:77000, g:5, mc:130000, pe:null, pr:"F/A-18 · KC-46 · 737/787 · Satellites", d:"Defense, Space & Security segment: F/A-18, KC-46 tanker, T-7 trainer, MQ-25 drone, satellites. Commercial Aviation recovery driving balance sheet repair. Still working through 737 MAX and 777X.", ri:["Commercial quality/certification","KC-46/T-7 fixed-price losses"], ca:["737 MAX stabilization","Commercial delivery ramp","Defense backlog execution"], dc:{f:-2500,gr:15,w:10,tg:2,sh:760}, ms:{bg:.65,cf:.6,ex:.8,ra:.5}, fin:{beta:1.5,eps:-8.50,div:0,rg:[-30,10,20,18,15]}, rs:[["Commercial Airplanes",45],["Defense Space & Security",30],["Global Services",22],["Other",3]], geo:[["US",42],["Europe",22],["Middle East",12],["APAC",20],["Other",4]], tc:[["US DoD",28],["Airlines (commercial)",50],["NASA/Space",10],["International govt",12]], pl:[{name:"737 MAX",desc:"Narrowbody · post-grounding recovery · 42/mo target",pos:"Core cash generator (post-recovery)"},{name:"787 Dreamliner",desc:"Widebody · production recovery",pos:"Long-cycle franchise"},{name:"F-15EX",desc:"4.5-gen fighter · production ramp",pos:"Franchise"},{name:"KC-46 Tanker",desc:"Aerial refueling · fixed-price struggle",pos:"Loss program"},{name:"T-7A Red Hawk",desc:"Trainer jet · fixed-price loss program",pos:"Development"},{name:"MQ-25 Stingray",desc:"Naval refueling UAV",pos:"Emerging"}], cp:["LMT","NOC","RTX","GD","HII","Airbus","Embraer"], ops:{hq:"Arlington, VA",fd:1916,emp:172000,bl:{label:"Backlog",val:511,unit:"B"},ne:"Apr 2026"}, own:{insider:.1,institutional:66} },
  { t:"HII", themes:["defense"], cc:"🇺🇸", nm:"Huntington Ingalls", v:"shipbuilding", s:"Naval", r:11500, g:11, mc:9000, pe:15, pr:"Ford-class carriers · Virginia subs · Columbia", d:"Largest U.S. military shipbuilder. Newport News (nuclear carriers, Virginia subs), Ingalls (DDG-51, amphibs). Beneficiary of naval shipbuilding buildout and Columbia program.", ri:["Labor cost inflation","Fixed-price carrier contracts"], ca:["Columbia SSBN volume","DDG-51 Flight III deliveries","Multi-ship Virginia blocks"], dc:{f:600,gr:5,w:8,tg:2,sh:40}, ms:{bg:.95,cf:.7,ex:.2,ra:.4}, fin:{beta:.7,eps:15.80,div:5.40,rg:[2,4,5,5,6]}, rs:[["Newport News Shipbuilding",50],["Ingalls Shipbuilding",28],["Mission Technologies",22]], geo:[["US Navy/DoD",93],["International (unmanned, LCS)",7]], tc:[["US Navy",75],["DoD (other)",10],["Mission Technologies commercial",10],["International FMS",5]], pl:[{name:"Ford-class Carriers",desc:"CVN-78/79/80/81 · Newport News monopoly",pos:"Monopoly"},{name:"Virginia-class SSN",desc:"Split w/ GD · 2-per-year cadence target",pos:"Duopoly"},{name:"Columbia-class SSBN",desc:"First-ship construction · partner w/ GD",pos:"Priority program"},{name:"DDG-51 Flight III",desc:"Arleigh Burke destroyers · Ingalls build",pos:"Active"},{name:"Amphibs (LHA/LPD)",desc:"America-class · San Antonio-class",pos:"Franchise"},{name:"Mission Technologies",desc:"Unmanned systems · services · intel",pos:"Growth"}], cp:["GD","LMT","Austal USA","BWXT (reactors)","CW (pumps)"], ops:{hq:"Newport News, VA",fd:2011,emp:44000,bl:{label:"Backlog",val:46,unit:"B"},ne:"May 2026"}, own:{insider:.1,institutional:89} },
  { t:"LHX", themes:["defense","drones","space"], cc:"🇺🇸", nm:"L3Harris Technologies", v:"electronics", s:"C4ISR", r:21000, g:22, mc:45000, pe:21, pr:"C4ISR · Tactical comms · Space payloads · EW", d:"Post-L3/Harris merger — tactical communications, space payloads, EW, night vision. Acquired Aerojet Rocketdyne 2023, adding solid rocket motors (a critical bottleneck).", ri:["Integration cost absorption","Mid-tier competitive pressure"], ca:["Rocket motor demand surge","Space payload wins","Tactical comms modernization"], dc:{f:2200,gr:8,w:8,tg:2,sh:190}, ms:{bg:.9,cf:.85,ex:.7,ra:.4}, fin:{beta:.6,eps:11.40,div:4.60,rg:[3,6,7,8,8]}, rs:[["Space & Airborne Systems",35],["Integrated Mission Systems",30],["Communication Systems",22],["Aerojet Rocketdyne (motors)",13]], geo:[["US",77],["International",23]], tc:[["US DoD",70],["International FMS",22],["Commercial aviation",5],["Other",3]], pl:[{name:"F-35 EOTS/DAS",desc:"F-35 electro-optical targeting + distributed aperture",pos:"Sole-source"},{name:"Tactical Communications",desc:"Handheld/manpack radios (Falcon III/IV)",pos:"Category leader"},{name:"Aerojet Rocketdyne",desc:"Solid rocket motors · acquired 2023",pos:"Critical bottleneck"},{name:"Night Vision",desc:"Army night vision goggles · PVS-31/ENVG-B",pos:"Franchise"},{name:"GPS III / ISAM",desc:"Space payload + military space",pos:"Recurring"},{name:"Electronic Warfare",desc:"EW pods + jammers · Next Gen Jammer",pos:"Growth"}], cp:["LMT","NOC","RTX","BAH","CACI","MRCY"], ops:{hq:"Melbourne, FL",fd:2019,emp:48000,bl:{label:"Backlog",val:34,unit:"B"},ne:"Apr 2026"}, own:{insider:.1,institutional:88} },
  { t:"TXT", themes:["defense","drones"], cc:"🇺🇸", nm:"Textron Inc", v:"primes", s:"Air", r:14000, g:14, mc:14000, pe:14, pr:"Bell helicopters · Cessna · Shadow drones · AAI", d:"Bell Textron (V-280 Valor winner, commercial helos), Cessna/Beech (bizjets), defense systems (Shadow UAV). FLRAA (V-280) is largest Army program since Blackhawk.", ri:["V-280 development risk","Bizjet cycle exposure"], ca:["V-280 Valor engineering & manufacturing","Citation backlog","EOD UAV growth"], dc:{f:800,gr:5,w:9,tg:2,sh:185}, ms:{bg:.7,cf:.6,ex:.5,ra:.5}, fin:{beta:1.0,eps:5.45,div:.08,rg:[3,5,6,6,7]}, rs:[["Bell",18],["Textron Aviation (Cessna/Beech)",42],["Industrial",18],["Systems (defense UAS)",12],["Finance",10]], geo:[["US",62],["Europe",18],["APAC",10],["ROW",10]], tc:[["Commercial bizjet buyers",40],["US Army (Bell V-280)",15],["FMS (Bell/Shadow)",15],["Industrial customers",20],["Other",10]], pl:[{name:"Bell V-280 Valor",desc:"FLRAA program winner · replaces Blackhawk · ~$80B lifetime",pos:"Army franchise"},{name:"Cessna Citation",desc:"Best-selling bizjet family",pos:"Category leader"},{name:"Beechcraft King Air",desc:"Twin-turboprop utility/King Air 360",pos:"Franchise"},{name:"Shadow / Aerosonde UAS",desc:"Group 3 tactical UAS · AAI legacy",pos:"DoD recurring"},{name:"Bell 525/505",desc:"Commercial helicopters",pos:"Mid-market"}], cp:["BA","LMT","RTX","LHX","Gulfstream (GD)","Airbus"], ops:{hq:"Providence, RI",fd:1923,emp:34000,ne:"Apr 2026"}, own:{insider:.1,institutional:90} },

  /* ═══════════════ DEFENSE · ELECTRONICS & SENSORS ═══════════════ */
  { t:"MRCY", themes:["defense","space"], cc:"🇺🇸", nm:"Mercury Systems", v:"electronics", s:"Sensors", r:860, g:26, mc:2600, pe:null, pr:"Signal processing · Mission computers · RF", d:"Embedded computing and RF subsystems for radar, EW, and missile seekers. Multi-year turnaround focused on margin recovery. Benefits from every radar and EW upgrade.", ri:["Margin recovery execution","Program charges"], ca:["Margin recovery plan","Radar modernization cycle"], dc:{f:50,gr:10,w:11,tg:2,sh:58}, ms:{bg:.85,cf:.7,ex:.4,ra:.4}, fin:{beta:1.3,eps:-.90,div:0,rg:[-5,3,6,10,12]}, rs:[["Radar",35],["Electronic Warfare",25],["Mission Computers",20],["C4I / Other",20]], geo:[["US",85],["International",15]], tc:[["LMT",22],["RTX",18],["NOC",15],["Other primes",25],["International",12],["Direct DoD",8]], pl:[{name:"Signal Processing",desc:"SOSA-aligned mission computers · radar backends",pos:"Key supplier"},{name:"RF & Microwave",desc:"EW subsystems · integrated RF modules",pos:"Subsystem role"},{name:"Rugged Servers",desc:"MIL-STD compute for platform integrators",pos:"Franchise"},{name:"Custom SoCs",desc:"ASIC/FPGA + SiC/GaN power conversion",pos:"Growth"},{name:"SKYREACH ISR",desc:"Signal intelligence payloads",pos:"Specialty"}], cp:["CW","HEI","TDG","SAIC (integration)","CACI"], ops:{hq:"Andover, MA",fd:1981,emp:2400,ne:"May 2026"}, own:{insider:6,institutional:75} },
  { t:"CUB", themes:["defense"], cc:"🇺🇸", nm:"Cubic Corporation", v:"electronics", s:"C4ISR", r:1400, g:25, mc:3000, pe:null, pr:"Training simulators · Transport payments · C2", d:"Defense training systems (live, virtual, constructive), mission systems. Privately acquired in 2021; modeled here as a public-equivalent pure-play. Used as sensor proxy.", ri:["Private status limits liquidity","Small scale"], ca:["Training sim demand","Force-on-force simulation"], dc:{f:80,gr:6,w:10,tg:2,sh:30}, ms:{bg:.8,cf:.6,ex:.5,ra:.4}, fin:{beta:1.1,eps:.10,div:0,rg:[1,3,5,6,7]} },
  { t:"HEI", themes:["defense","drones","space"], cc:"🇺🇸", nm:"HEICO Corporation", v:"electronics", s:"Sensors", r:4200, g:40, mc:32000, pe:60, pr:"Aftermarket parts · Electronics · Specialty products", d:"PMA (parts manufacturer approval) aftermarket replacement parts + defense electronics (ETG segment). Premium valuation reflects long track record of compounding acquisitions.", ri:["60x P/E premium","Acquisition pipeline dependency"], ca:["Defense electronics M&A","Commercial aftermarket cycle"], dc:{f:700,gr:12,w:9,tg:2,sh:138}, ms:{bg:.6,cf:.55,ex:.5,ra:.4}, fin:{beta:.9,eps:3.90,div:.20,rg:[8,12,14,12,14]}, rs:[["Flight Support Group (PMA + commercial)",55],["Electronic Technologies (defense)",45]], geo:[["US",70],["International",30]], tc:[["Commercial airlines (global)",42],["US DoD",25],["MROs",18],["International FMS",10],["Other",5]], pl:[{name:"PMA Replacement Parts",desc:"FAA-approved alternatives to OEM parts",pos:"Category leader"},{name:"Specialty Electronics",desc:"Mission-critical subsystems for defense",pos:"Niche leader"},{name:"Spectra Aerospace & Defense",desc:"Acquisition · space electronics",pos:"Recent M&A"},{name:"Exxelia",desc:"French electronics · high-rel capacitors",pos:"Global expansion"},{name:"DME distribution",desc:"Distribution of electronic components",pos:"Aggregation"}], cp:["TDG","CW","Moog","Curtiss-Wright"], ops:{hq:"Hollywood, FL",fd:1957,emp:10000,ne:"May 2026"}, own:{insider:8,institutional:65} },
  { t:"TDG", themes:["defense","drones","space"], cc:"🇺🇸", nm:"TransDigm Group", v:"electronics", s:"Sensors", r:7800, g:60, mc:75000, pe:40, pr:"Proprietary aerospace components · Sole-source parts", d:"Highly engineered, often sole-source aerospace components. Defense revenue ~35%. PE-style roll-up model with aggressive pricing power on legacy platforms.", ri:["Pricing scrutiny (DOD audits)","Roll-up model fatigue"], ca:["Defense aftermarket cycle","Continued M&A execution"], dc:{f:2400,gr:10,w:9,tg:2,sh:55}, ms:{bg:.7,cf:.6,ex:.5,ra:.4}, fin:{beta:1.1,eps:30.50,div:0,rg:[10,14,15,12,13]}, rs:[["Power & Control",54],["Airframe",38],["Non-aviation",8]], geo:[["US",67],["Europe",18],["APAC",10],["ROW",5]], tc:[["Boeing",18],["Airbus",15],["US DoD (direct+tier)",25],["International airlines (aftermarket)",32],["Other",10]], pl:[{name:"Aerospace Pumps & Valves",desc:"Sole-source on legacy platforms · high-margin",pos:"Proprietary"},{name:"Airframe Components",desc:"Latches, locks, sensors · dispatch-critical",pos:"Sole-source leverage"},{name:"Electrical Subsystems",desc:"Motors/actuators/power controls",pos:"Franchise"},{name:"Ignition & Sensors",desc:"Engine ignition · environmental",pos:"Niche"},{name:"Calspan (recent M&A)",desc:"Flight test + simulation services",pos:"New segment"}], cp:["HEI","MOG.A","CW","Woodward","Crane NXT"], ops:{hq:"Cleveland, OH",fd:1993,emp:17000,ne:"May 2026"}, own:{insider:.5,institutional:91} },

  /* ═══════════════ DEFENSE · SERVICES & IT ═══════════════ */
  { t:"LDOS", themes:["defense","space"], cc:"🇺🇸", nm:"Leidos Holdings", v:"services", s:"Analytics", r:17000, g:14, mc:20000, pe:16, pr:"IT services · Health · Cyber · Airport security", d:"Largest defense IT services firm. Dynetics subsidiary does hypersonic / missile defense demo programs. Also airport scanners (TSA CT).", ri:["Margin pressure in services","Recompete risk"], ca:["Trusted Mission Cyber","Hypersonic flight tests"], dc:{f:1200,gr:6,w:9,tg:2,sh:135}, ms:{bg:.85,cf:.6,ex:.3,ra:.4}, fin:{beta:.8,eps:10.80,div:1.52,rg:[3,5,6,7,8]}, rs:[["Health",24],["Civil",30],["Defense Systems",20],["Intelligence (DynetiCS)",26]], geo:[["US",87],["UK + Australia",10],["Other",3]], tc:[["DoD",42],["VA (health)",18],["Intel Community",15],["Civil Federal",20],["International",5]], pl:[{name:"Dynetics hypersonic programs",desc:"Hypersonic test + glide vehicles · DoD",pos:"Emerging weapons"},{name:"VA Health (CMOP)",desc:"Veterans Affairs prescription dispensing",pos:"Incumbent"},{name:"TSA Security CT",desc:"Airport scanners · CT scanner replacements",pos:"Sole-source cycle"},{name:"Trusted Mission Cyber",desc:"DoD cyber ops support",pos:"Recompete won"},{name:"Gibbs Roadrunner",desc:"Army ground autonomy",pos:"Emerging"}], cp:["BAH","CACI","SAIC","ACN Federal","BHE","KBR"], ops:{hq:"Reston, VA",fd:2013,emp:48000,ne:"Apr 2026"}, own:{insider:.1,institutional:85} },
  { t:"BAH", themes:["defense","quantum"], cc:"🇺🇸", nm:"Booz Allen Hamilton", v:"services", s:"Analytics", r:12000, g:20, mc:18000, pe:20, pr:"Consulting · AI analytics · Cyber", d:"Consulting-led defense/intel services firm. Heavy in intel community and special operations. First mover on AI analytics for DoD.", ri:["Consulting hiring cycle","Recompete risk"], ca:["AI/ML for DoD","Intel cycle visibility"], dc:{f:800,gr:8,w:9,tg:2,sh:130}, ms:{bg:.85,cf:.6,ex:.2,ra:.4}, fin:{beta:.8,eps:6.40,div:2.10,rg:[4,7,9,10,10]}, rs:[["Defense",58],["Civil (federal)",22],["Intelligence",20]], geo:[["US",96],["International",4]], tc:[["US DoD",55],["Civil (HHS, Treasury, etc.)",22],["Intel Community",20],["Commercial/Intl",3]], pl:[{name:"AI/ML for DoD",desc:"ML pipelines + data platforms for defense",pos:"Leading position"},{name:"Cyber",desc:"DoD + civil cyber ops · consulting led",pos:"Growth"},{name:"Digital Battlespace",desc:"Battlespace ops support · JADC2 integration",pos:"Strategic"},{name:"VoLT (Velocity) sales",desc:"Recurring technical services",pos:"Platform"}], cp:["CACI","LDOS","SAIC","ACN Federal","KBR","BHE"], ops:{hq:"McLean, VA",fd:1914,emp:35000,ne:"May 2026"}, own:{insider:.2,institutional:82} },
  { t:"OXIGY", themes:["quantum"], cc:"🇬🇧", nm:"Oxford Instruments (ADR)", v:"enablers", s:"Cryostats", r:580, g:48, mc:1900, pe:24, pr:"Triton dilution refrigerators · Cryogen-free magnets · NanoScience tools", d:"World leader in dilution refrigerators — the cryogenic systems required to cool superconducting qubits to ~10 millikelvin (colder than outer space). Triton platform powers most superconducting quantum computers including IBM, Google, Rigetti research labs. Also makes magnets, plasma tech, and X-ray analysis tools. Pure-play picks-and-shovels for the entire superconducting + spin qubit ecosystem.", ri:["Helium-3 supply constraints","Customer concentration","UK economic exposure"], ca:["Quantum capacity expansion","Bluefors competition response","Helium-3 recovery investments","DARPA QBI ramp"], dc:{f:80,gr:11,w:9,tg:2,sh:58}, ms:{rd:.95,eg:.85,cl:.4,ra:.5}, fin:{beta:1.1,eps:1.30,div:.55,rg:[8,12,15,12,10]}, rs:[["NanoScience (incl. Triton)",36],["Materials Analysis (X-Ray + EDS)",30],["Plasma Technology (PVD/CVD)",22],["Andor (cameras for science)",12]], geo:[["Europe",36],["Americas",26],["Asia",30],["Other",8]], tc:[["University labs / national labs",34],["Quantum hardware OEMs (IBM, IONQ, RGTI, etc.)",16],["Semiconductor research",18],["Industrial materials customers",22],["Pharmaceutical R&D",10]], pl:[{name:"Triton Dilution Refrigerator",desc:"World standard sub-Kelvin cryostat · 10 mK base · used by IBM, Google, RGTI",pos:"Category leader"},{name:"Proteox modular DR",desc:"Modular dilution refrigerator · scales for fault-tolerant quantum",pos:"Next-gen"},{name:"NanoScience cryogen-free magnets",desc:"Up to 22 Tesla · superconducting magnets for quantum + materials",pos:"Franchise"},{name:"Plasma Pro 100 (PVD/CVD)",desc:"Atomic layer deposition · etch · for quantum + semi devices",pos:"Strategic"},{name:"Andor sCMOS cameras",desc:"Scientific imaging · used in trapped ion + atom quantum systems",pos:"Diversifier"},{name:"X-Max EDS detectors",desc:"Energy dispersive X-ray spectroscopy · materials characterization",pos:"Cash cow"}], cp:["Bluefors (pvt Finland)","Janis (Lake Shore Cryotronics)","BlueFors","Cryomech","Quantum Design"], ops:{hq:"Abingdon, UK",fd:1959,emp:2200,mfg:["Abingdon UK","Bristol UK","Yatton UK","Wiesbaden DE"],ne:"Late May 2026"}, own:{insider:.5,institutional:75} },
  { t:"MKSI", themes:["quantum","ai"], cc:"🇺🇸", nm:"MKS Instruments", v:"enablers", s:"Lasers/Photonics", r:3650, g:48, mc:6500, pe:32, pr:"Lasers · Photonics · Vacuum · Atomfab plasma · Spectra-Physics", d:"Critical photonics + vacuum supplier to semicap and quantum. Spectra-Physics laser business (acquired Newport 2016) provides ultra-stable lasers used in trapped-ion and atom quantum systems. Photon Control + Coherent assets serve metrology, gas analysis. Also major semicap subsystem supplier (deposition, etch, CMP). Atotech acquired 2022 added wet chemistry / electronics specialty.", ri:["Semiconductor capex cycle","Atotech debt overhang","Currency"], ca:["Semicap recovery","Quantum laser demand","ALD/EUV capacity"], dc:{f:340,gr:8,w:11,tg:2,sh:67}, ms:{rd:.7,eg:.7,cl:.5,ra:.6}, fin:{beta:1.6,eps:5.10,div:.88,rg:[5,12,18,15,10]}, rs:[["Vacuum Solutions (semicap)",46],["Photonics & Lasers",26],["Material Solutions (Atotech)",28]], geo:[["Asia",54],["Americas",26],["Europe",18],["Other",2]], tc:[["AMAT",14],["LRCX",11],["TEL",9],["ASML",7],["Quantum + scientific labs",6],["Other industrial",53]], pl:[{name:"Spectra-Physics Lasers",desc:"Ultra-stable CW + pulsed lasers · trapped ion + atom interferometry",pos:"Quantum-critical"},{name:"Atomfab Plasma Sources",desc:"Atomic layer deposition for advanced semis + quantum chip fab",pos:"Growth vector"},{name:"Pressure measurement (capacitance manometers)",desc:"Industry standard vacuum gauges · semicap workhorse",pos:"Franchise"},{name:"RF + DC power supplies",desc:"Plasma generation · etch + deposition tools",pos:"Captive demand"},{name:"Photon Control + Spectra-Physics + Newport",desc:"Optical components, motion stages, spectrometers",pos:"Diversified"},{name:"Atotech (electronics chemistry)",desc:"Wet chemistry for PCB + advanced packaging",pos:"M&A integration"}], cp:["AMAT (subsystems)","Trumpf (pvt)","II-VI/COHR","Veeco","Inficon"], ops:{hq:"Andover, MA",fd:1961,emp:11000,ne:"Early May 2026"}, own:{insider:.5,institutional:96} },
  { t:"PANW", themes:["quantum","ai"], cc:"🇺🇸", nm:"Palo Alto Networks", v:"security", s:"Quantum Safe", r:9650, g:74, mc:140000, pe:50, pr:"Strata firewalls · Prisma · Cortex XSIAM · PQC migration", d:"Largest pure-play cybersecurity company. Major PQC migration leader — added Quantum Random Number Generation (QRNG) to NGFW, ML-KEM (Kyber) post-quantum encryption to PAN-OS 2025. Strong AI security via Cortex + Prisma AIRS. Customers prepping for harvest-now-decrypt-later threat. NIST PQC standards finalized = enterprise migration acceleration.", ri:["Platformization growth pace","CRWD/ZS/CYBR competition","Macro IT budget"], ca:["NIST PQC standards finalization","ML-KEM rollout","Platformization wins","AI security growth"], dc:{f:2200,gr:18,w:8,tg:2,sh:660}, ms:{rd:.6,eg:.5,cl:.95,ra:.5}, fin:{beta:1.0,eps:6.40,div:0,rg:[18,22,25,16,15]}, rs:[["Network Security (Strata)",62],["Cloud Security (Prisma)",24],["Security Operations (Cortex)",14]], geo:[["Americas",64],["EMEA",22],["JAPAC",14]], tc:[["Enterprise (>5000 employees)",52],["US Federal/SLED",14],["Mid-market",18],["MSP/Channel",10],["Other",6]], pl:[{name:"PA-Series NGFW (Strata)",desc:"Hardware + virtual next-gen firewalls · industry standard",pos:"Category leader"},{name:"Prisma SASE (Access)",desc:"Cloud-delivered security · Zscaler competitor",pos:"Growth engine"},{name:"Cortex XSIAM",desc:"AI-driven security operations · SIEM replacement push",pos:"Strategic"},{name:"PAN-OS 2025 (PQC ready)",desc:"ML-KEM Kyber post-quantum encryption · QRNG integrated",pos:"Quantum-safe leader"},{name:"Prisma AIRS",desc:"AI runtime security · MCP + agent protection · 2026 launch",pos:"AI vector"},{name:"Cloud-Delivered Security Services",desc:"WildFire + URL filtering + DNS · subscription attach",pos:"Recurring rev"}], cp:["CRWD","CSCO","FTNT","CHKP","ZS","NET","CYBR"], ops:{hq:"Santa Clara, CA",fd:2005,emp:14500,bl:{label:"RPO",val:14,unit:"B"},ne:"Late May 2026"}, own:{insider:.4,institutional:80} },
  { t:"NET", themes:["quantum","ai"], cc:"🇺🇸", nm:"Cloudflare Inc.", v:"security", s:"PQC", r:1830, g:78, mc:50000, pe:null, pr:"Edge network · Workers · Zero Trust · PQC by default", d:"Edge cloud + security network. First major CDN to deploy post-quantum cryptography (Kyber/X25519+Kyber) at scale across customer sites by default (2024). Workers AI for inference at edge. Strong AI growth via Workers + R2 storage. Full hybrid PQC available to all customers without configuration. Zero Trust (Cloudflare One) growing 30%+.", ri:["Pricing pressure","R2 vs S3 win rate","Macro IT budget"], ca:["Workers AI inference","PQC enterprise lock-in","Hyperdrive D1 adoption"], dc:{f:140,gr:25,w:14,tg:3,sh:340}, ms:{rd:.6,eg:.5,cl:.95,ra:.6}, fin:{beta:1.6,eps:.10,div:0,rg:[35,32,28,28,25]} },
  { t:"CRWD", themes:["quantum","ai"], cc:"🇺🇸", nm:"CrowdStrike Holdings", v:"security", s:"PQC", r:4400, g:78, mc:108000, pe:90, pr:"Falcon endpoint · Charlotte AI · PQC roadmap", d:"Largest pure-play endpoint security. Falcon platform integrating PQC across kernel-level encryption + key management. ML-KEM trial deployments. Charlotte AI agentic SOC. Major NRR ~120%+ via platform consolidation. July 2024 outage recovery complete by Q4 2024.", ri:["Platform consolidation pace","July 2024 outage memory","Premium valuation"], ca:["Cloud workload protection growth","Identity protection ramp","PQC enterprise wins"], dc:{f:1100,gr:22,w:12,tg:2,sh:250}, ms:{rd:.5,eg:.5,cl:.95,ra:.6}, fin:{beta:1.1,eps:1.50,div:0,rg:[36,30,28,25,22]} },
  { t:"VRSN", themes:["quantum"], cc:"🇺🇸", nm:"Verisign Inc.", v:"security", s:"PQC", r:1620, g:88, mc:25000, pe:30, pr:".com/.net registry · DNS infrastructure · DNSSEC PQC migration", d:"Operates .com and .net top-level domain registries. Critical PQC migration target — DNSSEC needs PQC signatures (NIST has approved ML-DSA Dilithium). Working on next-gen quantum-safe DNSSEC. Mid-cap dividend payer with monopoly franchise. Aging .com base offset by emerging gTLD revenue.", ri:["Domain growth slowdown","Pricing regulation (DOC contract)","gTLD competition"], ca:["DNSSEC PQC standards",".com price increases","Buybacks + dividend"], dc:{f:850,gr:5,w:7,tg:2,sh:97}, ms:{rd:.4,eg:.6,cl:.5,ra:.5}, fin:{beta:.8,eps:9.20,div:1.85,rg:[5,4,5,5,4]} },
  { t:"ATOM", themes:["quantum","ai"], cc:"🇺🇸", nm:"Atomera Incorporated", v:"enablers", s:"Silicon", r:5, g:60, mc:280, pe:null, pr:"MST (Mears Silicon Technology) · Quantum dot + RF licensing", d:"Tiny silicon engineering IP licensing company. MST technology adds engineered silicon layers to improve performance and isolation — applicable to spin qubit quantum chips, RF, and advanced node logic. Multiple Tier-1 foundry JDLA agreements. Pre-revenue at scale; speculative call option on silicon spin quantum + analog upside.", ri:["Pre-meaningful-revenue","Customer royalty conversion","Cash burn"], ca:["JDLA → license conversion","Silicon spin quantum adoption","RF SOI ramp"], dc:{f:-20,gr:-50,w:18,tg:3,sh:30}, ms:{rd:.95,eg:.95,cl:.2,ra:.7}, fin:{beta:2.5,eps:-.80,div:0,rg:[10,30,50,80,100]} },
  { t:"CACI", themes:["defense"], cc:"🇺🇸", nm:"CACI International", v:"services", s:"IT", r:7800, g:13, mc:9000, pe:18, pr:"Intel IT · EW · Signals intelligence", d:"Mid-cap intel/EW services firm. Expertise in SIGINT, EW countermeasures, and tactical comms. Shorter contract cycle than peers.", ri:["Smaller scale","Contract concentration"], ca:["EW modernization","Intel IT growth"], dc:{f:500,gr:7,w:9,tg:2,sh:22}, ms:{bg:.85,cf:.6,ex:.3,ra:.4}, fin:{beta:.9,eps:18.00,div:0,rg:[4,6,8,9,10]}, rs:[["Expertise (consulting + SETA)",55],["Technology (software-defined products)",45]], geo:[["US",94],["UK/Allies",6]], tc:[["US DoD",62],["Intel Community",22],["Federal civil",10],["State/local/commercial",6]], pl:[{name:"Photon EW (electronic warfare)",desc:"Airborne + ground EW systems",pos:"Growth"},{name:"SGSS (Satellite Ground)",desc:"NRO / SDA ground segment",pos:"Strategic"},{name:"Cyber Ops (Continuous Monitoring)",desc:"CISA + DoD cyber support",pos:"Franchise"},{name:"Intelligence Systems",desc:"Classified intel community analytic support",pos:"Core"},{name:"Mission Support Services",desc:"Engineering/integration recompete business",pos:"Stable"}], cp:["LDOS","BAH","SAIC","KBR","ManTech (acq)"], ops:{hq:"Reston, VA",fd:1962,emp:23000,bl:{label:"Backlog",val:35,unit:"B"},ne:"Late Apr 2026"}, own:{insider:.5,institutional:93} },
  { t:"SAIC", themes:["defense","space"], cc:"🇺🇸", nm:"SAIC Inc", v:"services", s:"IT", r:7400, g:12, mc:6000, pe:15, pr:"IT services · Space · Enterprise IT", d:"Pure-play defense/federal IT services. Army, Navy, Air Force enterprise IT and ground systems. Steady low-margin recurring business.", ri:["Government shutdown risk","Low GM"], ca:["Space/ground systems wins","Enterprise IT modernization"], dc:{f:400,gr:4,w:9,tg:2,sh:50}, ms:{bg:.85,cf:.5,ex:.2,ra:.4}, fin:{beta:.8,eps:8.20,div:1.48,rg:[2,4,5,5,6]}, rs:[["Defense (DoD)",48],["Intelligence Community",24],["Civil (federal civilian)",28]], geo:[["US",99],["Intl",1]], tc:[["Army",20],["Navy",15],["Air Force",13],["Intel Community",24],["NASA",9],["Civil agencies",19]], pl:[{name:"Army EITaaS Enterprise IT",desc:"Army modernization · multi-yr $11B program",pos:"Mega contract"},{name:"NASA NCAPS",desc:"IT consolidation · NASA-wide",pos:"Strategic"},{name:"DigitalEdge AI",desc:"Mission AI for intel + DoD",pos:"AI positioning"},{name:"CLOUDES",desc:"Cloud engineering + FedRAMP",pos:"Growth"},{name:"Space Development Agency support",desc:"SDA T1/T2 integration",pos:"Space adjacency"}], cp:["LDOS","CACI","BAH","Peraton (pvt)"], ops:{hq:"Reston, VA",fd:1969,emp:24000,bl:{label:"Backlog",val:23,unit:"B"},ne:"Early Jun 2026"}, own:{insider:.4,institutional:94} },
  { t:"PLTR", themes:["defense","ai"], cc:"🇺🇸", nm:"Palantir Technologies", v:"services", s:"Analytics", r:3200, g:80, mc:210000, pe:300, pr:"Foundry · Gotham · AIP", d:"Government (Gotham) and commercial (Foundry) data platforms with Apollo deployment. AIP (Artificial Intelligence Platform) is the main growth narrative — enterprise LLM orchestration layer. Dual-tagged across defense and AI themes.", ri:["300x P/E valuation","Stock-based comp dilution"], ca:["AIP bootcamp conversion","TITAN and Maven Smart System","International govt wins"], dc:{f:1100,gr:30,w:10,tg:3,sh:2350}, ms:{bg:.8,cf:.7,ex:.3,ra:.3,ta:.2,ch:.3,ai:.95}, fin:{beta:2.3,eps:.35,div:0,rg:[15,25,35,40,35]}, rs:[["Government",55],["Commercial",45]], geo:[["US",65],["UK / Europe",20],["APAC",8],["ROW",7]], tc:[["US DoD / Army",22],["US Intel Community",18],["Commercial US",30],["UK NHS + govt",12],["International govt",10],["Other",8]], pl:[{name:"AIP (Artificial Intelligence Platform)",desc:"Enterprise LLM orchestration · bootcamps → contracts",pos:"Flagship commercial"},{name:"Gotham",desc:"Govt data platform · intel/defense core",pos:"Classified"},{name:"Foundry",desc:"Commercial data ops platform",pos:"Enterprise core"},{name:"Apollo",desc:"Edge deployment · air-gapped + cloud",pos:"Infra layer"},{name:"TITAN",desc:"US Army deep-sensing ground station",pos:"Flagship defense"},{name:"Maven Smart System",desc:"DoD battlefield AI · 4-yr $480M expansion",pos:"Growing"}], cp:["MSFT","GOOG","AMZN","CRWD","NET","SNOW"], ops:{hq:"Denver, CO",fd:2003,emp:3900,ne:"May 2026"}, own:{insider:8,institutional:45} },

  /* ═══════════════ DEFENSE · UNMANNED & EMERGING ═══════════════ */
  { t:"AVAV", themes:["defense","drones"], cc:"🇺🇸", nm:"AeroVironment Inc", v:"emerging", s:"Unmanned", r:900, g:35, mc:7000, pe:50, pr:"Switchblade · Puma · Jump 20 · BlueHalo (EW, directed energy)", d:"Tactical drones (Puma, Raven) and loitering munitions (Switchblade 300/600). Acquired BlueHalo 2025 adding EW, directed energy, and space. Core Ukraine beneficiary.", ri:["BlueHalo integration","Program-lump revenue"], ca:["Switchblade surge + FMS","BlueHalo cross-sell","Army LUAS program"], dc:{f:80,gr:35,w:11,tg:3,sh:28}, ms:{bg:.9,cf:.95,ex:.9,ra:.3}, fin:{beta:1.3,eps:2.00,div:0,rg:[10,20,30,35,30]}, rs:[["Uncrewed Systems (tactical UAV + loitering)",55],["BlueHalo segment (EW/DE/space)",35],["MacCready Works (R&D/HAPS)",10]], geo:[["US (DoD)",72],["FMS & Ukraine",22],["Commercial/Other",6]], tc:[["US Army",35],["US Marines",14],["Ukraine (via FMS)",18],["Other NATO FMS",15],["Classified/DoD",12],["Commercial",6]], pl:[{name:"Switchblade 300/600",desc:"Loitering munition · Ukraine deployment · surge",pos:"Category leader"},{name:"Puma AE",desc:"Small tactical UAV · Block 2",pos:"Franchise"},{name:"JUMP 20",desc:"Group 3 VTOL UAV · Arcturus legacy",pos:"Active FMS"},{name:"BlueHalo Directed Energy",desc:"Titan C-UAS · Locust laser weapon",pos:"Growth"},{name:"BlueHalo Space",desc:"RF/space ops payloads · satellite systems",pos:"Cross-sell"},{name:"Raven RQ-11",desc:"Small UAV · Army legacy",pos:"Mature"}], cp:["KTOS","NOC","LMT","Anduril (private)","Teledyne FLIR","Skydio (private)"], ops:{hq:"Arlington, VA",fd:1971,emp:4200,bl:{label:"Backlog",val:2.1,unit:"B"},ne:"June 2026"}, own:{insider:1,institutional:85} },
  { t:"KTOS", themes:["defense","drones","space"], cc:"🇺🇸", nm:"Kratos Defense", v:"emerging", s:"Unmanned", r:1200, g:24, mc:8000, pe:80, pr:"Valkyrie UCAV · Mako target drone · Hypersonic · Tactical UAS", d:"Attritable UAV maker (XQ-58 Valkyrie), target drones, hypersonic test vehicles. Well-positioned for CCA (Collaborative Combat Aircraft) program and low-cost attritable mass.", ri:["80x P/E premium","CCA program competition"], ca:["CCA increment 2 wins","Hypersonic test cadence","Target drone FMS"], dc:{f:30,gr:15,w:11,tg:3,sh:155}, ms:{bg:.9,cf:.85,ex:.7,ra:.4}, fin:{beta:1.5,eps:.15,div:0,rg:[5,10,15,18,18]}, rs:[["KGS (Gov Solutions/Satcom)",55],["Unmanned Systems",25],["Turbine Technologies (jet engines)",20]], geo:[["US DoD",80],["FMS Allies",15],["Commercial space",5]], tc:[["US Air Force",45],["US Navy (target drones)",18],["US Army",12],["FMS Allies",15],["Commercial satcom",10]], pl:[{name:"XQ-58A Valkyrie",desc:"Attritable UCAV · CCA Increment 1 slot",pos:"Flagship"},{name:"Mako CCA",desc:"Lower-cost collaborative combat aircraft",pos:"CCA Inc 2 candidate"},{name:"BQM-167/177 target drones",desc:"Firebird target drones · sole source Navy",pos:"Recurring"},{name:"Firebird ISR",desc:"Optionally-manned ISR aircraft",pos:"Niche"},{name:"Hypersonic test vehicles",desc:"Zeus / Erinyes · DoD hypersonic flight test",pos:"Specialty"},{name:"TAS solid rocket motor facility",desc:"Florida · new SRM capacity",pos:"Expansion"}], cp:["AVAV","NOC","LMT","Anduril (private)","GA-ASI (private)"], ops:{hq:"San Diego, CA",fd:1994,emp:3500,bl:{label:"Backlog",val:1.5,unit:"B"},ne:"May 2026"}, own:{insider:1,institutional:79} },
  { t:"RKLB", themes:["defense","space"], cc:"🇺🇸", nm:"Rocket Lab USA", v:"emerging", s:"Space Defense", r:500, g:30, mc:26000, pe:null, pr:"Electron rocket · Neutron rocket · Space systems · HASTE (hypersonic)", d:"Small-launch leader (Electron), developing medium-lift Neutron. Growing space systems segment (satellite components, HASTE hypersonic test vehicle). Dual-tagged space and defense.", ri:["Neutron development risk","Small-launch ASP pressure"], ca:["Neutron maiden launch","HASTE demand surge","Space systems backlog"], dc:{f:-100,gr:40,w:15,tg:3,sh:500}, ms:{bg:.7,cf:.5,ex:.3,ra:.5}, fin:{beta:2.0,eps:-.40,div:0,rg:[0,30,60,80,80]}, rs:[["Space Systems (components/spacecraft)",82],["Launch Services",18]], geo:[["US",80],["International commercial",15],["Allied government",5]], tc:[["US DoD",32],["NASA",22],["Commercial constellations",28],["International govt",12],["Other",6]], pl:[{name:"Electron",desc:"Small-lift · 55+ launches · most in small class",pos:"#1 small-lift"},{name:"Neutron",desc:"Medium-lift · 13-ton to LEO · maiden 2026",pos:"Core thesis"},{name:"HASTE",desc:"Hypersonic test flight · DoD · variant of Electron",pos:"Fast ramp"},{name:"Photon Bus",desc:"Satellite spacecraft platform · Mars, Moon, LEO",pos:"Space Systems"},{name:"SDA T2 Tranche",desc:"18 satellites for Space Development Agency · $515M",pos:"Prime contractor"},{name:"Reaction Wheels / Star Trackers",desc:"Sinclair Interplanetary components",pos:"Supply position"}], cp:["LMT","NOC","LUNR","RDW","MAXR","SpaceX (private)","ULA (private)","Firefly (private)"], ops:{hq:"Long Beach, CA",fd:2006,emp:2500,bl:{label:"Backlog",val:1.85,unit:"B"},ne:"May 2026"}, own:{insider:8,institutional:62} },
  { t:"BWXT", themes:["defense","nuclear","space"], cc:"🇺🇸", nm:"BWX Technologies", v:"emerging", s:"Space Defense", r:2700, g:19, mc:10000, pe:22, pr:"Naval nuclear reactors · Microreactor · Medical isotopes", d:"Sole supplier of naval nuclear reactors for US Navy (Virginia/Columbia subs, carriers). Project Pele microreactor for DoD. Dual-tagged defense + nuclear — critical for both.", ri:["DOE contract concentration","Isotope supply constraints"], ca:["Columbia-class reactor production","Pele deployment","Medical isotope growth"], dc:{f:300,gr:6,w:9,tg:2,sh:92}, ms:{bg:.85,cf:.7,ex:.1,ra:.4,pp:.7,pl:.8,ur:.6,ai:.5}, fin:{beta:.9,eps:3.30,div:.92,rg:[4,6,8,9,9]}, rs:[["Government Operations (Navy reactors)",70],["Commercial Operations (medical + SMR)",20],["Advanced Technologies (Pele)",10]], geo:[["US",85],["Canada",10],["Intl (medical isotopes)",5]], tc:[["US Navy (naval reactors)",55],["DOE (Pantex/Y-12 ops)",20],["Commercial nuclear",15],["Medical/isotope",10]], pl:[{name:"Naval Nuclear Reactors",desc:"Sole-source Virginia/Columbia sub reactors + carriers",pos:"Sole-source"},{name:"Project Pele",desc:"Mobile microreactor for DoD · Idaho deployment",pos:"Demonstrator"},{name:"TRISO fuel",desc:"HALEU TRISO fuel production for X-energy",pos:"Fuel leadership"},{name:"Medical Isotopes",desc:"Mo-99 / Lu-177 / Ac-225 · cancer theranostics",pos:"Growing franchise"},{name:"Nuclear Operations (DOE)",desc:"Pantex, Y-12, Savannah River site operations",pos:"Recurring gov"}], cp:["CW","Framatome (pvt)","Westinghouse (CCJ/Brookfield)","GEH (pvt)"], ops:{hq:"Lynchburg, VA",fd:2015,emp:7400,ne:"May 2026"}, own:{insider:.2,institutional:85} },

  /* ═══════════════ NUCLEAR · UTILITIES ═══════════════ */
  { t:"CEG", themes:["nuclear"], cc:"🇺🇸", nm:"Constellation Energy", v:"utilities", s:"Merchant", r:24000, g:20, mc:90000, pe:30, pr:"Largest US nuclear fleet · Clean energy PPAs", d:"Largest nuclear operator in US (22 reactors). Signed the first major AI-datacenter PPA (Microsoft · Three Mile Island Unit 1 restart). Core pick for the AI power thesis.", ri:["Merchant power price volatility","PPA pricing visibility"], ca:["TMI restart 2028","Additional hyperscaler PPAs","PTC floor protection"], dc:{f:2500,gr:10,w:7,tg:2,sh:315}, ms:{pp:.9,pl:.85,ur:.5,ai:.95}, fin:{beta:1.0,eps:8.50,div:1.40,rg:[15,25,40,35,25]}, rs:[["Merchant Nuclear",55],["Competitive Gen & Retail",25],["Renewables & Hydro",12],["Natural Gas",8]], geo:[["PJM (Mid-Atlantic)",50],["NY/New England",25],["MISO",15],["ERCOT",10]], tc:[["AWS/MSFT/GOOG PPAs",18],["Wholesale (PJM)",52],["C&I direct",22],["Retail & other",8]], pl:[{name:"22-Reactor Fleet",desc:"Largest US nuclear fleet · ~32 GW · 90%+ capacity factor",pos:"Tier-1 IPP"},{name:"TMI Unit 1 Restart",desc:"Three Mile Island · Microsoft 20-yr PPA · 2028 restart",pos:"AI power flagship"},{name:"Crane Clean Energy",desc:"Rebranded TMI · ~835 MW",pos:"Landmark restart"},{name:"Ginna · Nine Mile · Calvert Cliffs",desc:"Existing nuclear base",pos:"License extensions"},{name:"Peach Bottom",desc:"Co-owned w/ EXC · ~2.5 GW",pos:"Established"}], cp:["VST","TLN","D","SO","NRG","EXC","XEL"], ops:{hq:"Baltimore, MD",fd:2022,emp:13000,bl:{label:"Identified PPA pipeline",val:3,unit:"B"},ne:"May 2026"}, own:{insider:.2,institutional:88} },
  { t:"VST", themes:["nuclear"], cc:"🇺🇸", nm:"Vistra Corp", v:"utilities", s:"Merchant", r:14500, g:22, mc:65000, pe:25, pr:"Merchant nuclear + gas · Texas peaker · Retail", d:"Merchant power operator — combo of Texas (ERCOT) gas, ~6.4 GW nuclear (Comanche Peak etc. via Energy Harbor acquisition), and retail electricity. AI datacenter exposure via PJM nuclear fleet.", ri:["ERCOT weather volatility","Commodity hedging"], ca:["AI-data center PPAs","Texas load growth","Nuclear capacity factor"], dc:{f:2200,gr:12,w:8,tg:2,sh:340}, ms:{pp:.95,pl:.7,ur:.4,ai:.95}, fin:{beta:1.1,eps:3.60,div:.88,rg:[12,22,35,40,25]}, rs:[["Retail (TXU)",35],["Gen - Gas",25],["Gen - Nuclear",18],["Gen - Renewables",12],["Other/Storage",10]], geo:[["ERCOT",65],["PJM",25],["NY/NE",10]], tc:[["Retail (5M+ customers)",45],["Wholesale PJM/ERCOT",40],["Direct C&I / AI DCs",12],["Other",3]], pl:[{name:"Comanche Peak",desc:"2.4 GW nuclear · TX · Energy Harbor addition",pos:"AI PPA ready"},{name:"Moss Landing BESS",desc:"Largest US battery storage · CA",pos:"Recovery post-fire"},{name:"TXU Energy",desc:"Largest TX retail electricity",pos:"5M+ customers"},{name:"PJM Nuclear Fleet",desc:"Energy Harbor acq · Beaver Valley/Davis-Besse/Perry",pos:"From 2024 deal"},{name:"Gas Peaker Fleet",desc:"ERCOT peakers · Lamar · Deepwater",pos:"Tight-market levers"}], cp:["NRG","CEG","TLN","EXC","D"], ops:{hq:"Irving, TX",fd:2018,emp:6800,ne:"May 2026"}, own:{insider:.4,institutional:82} },
  { t:"D", themes:["nuclear"], cc:"🇺🇸", nm:"Dominion Energy", v:"utilities", s:"Regulated", r:15000, g:25, mc:50000, pe:19, pr:"VA regulated utility · Millstone · North Anna", d:"Regulated Virginia utility serving Northern VA datacenter alley (Ashburn). ~3 GW nuclear (North Anna, Surry). Core beneficiary of Dominion-Virginia datacenter load growth.", ri:["Offshore wind project risk","Regulated rate case outcomes"], ca:["VA datacenter load forecast","Nuclear license extensions","SMR evaluation"], dc:{f:1500,gr:5,w:7,tg:2,sh:840}, ms:{pp:.6,pl:.8,ur:.5,ai:.9}, fin:{beta:.5,eps:3.00,div:2.67,rg:[2,3,4,5,6]}, rs:[["VA Power (regulated)",60],["DE Energy (regulated)",25],["Contracted Energy",10],["Other",5]], geo:[["Virginia",60],["North Carolina",20],["South Carolina/Georgia",10],["Other",10]], tc:[["Data centers (Northern VA alley)",28],["Residential",35],["Commercial",22],["Industrial",10],["Wholesale",5]], pl:[{name:"North Anna Nuclear",desc:"~1.8 GW · 2 units · VA · license renewal",pos:"Core fleet"},{name:"Surry Nuclear",desc:"~1.7 GW · VA · subsequent license renewal",pos:"Core fleet"},{name:"Millstone Unit 3 (stake)",desc:"Partial ownership · CT · co-owner w/ CEG",pos:"Minority"},{name:"VA DC Alley PPAs",desc:"Ashburn/Loudoun County hyperscaler loads",pos:"Load growth engine"},{name:"Offshore Wind (CVOW)",desc:"2.6 GW Coastal VA Offshore Wind · 2026 complete",pos:"Controversial"}], cp:["SO","NEE","DUK","AEP","XEL","EXC"], ops:{hq:"Richmond, VA",fd:1983,emp:17000,ne:"May 2026"}, own:{insider:.1,institutional:78} },
  { t:"SO", themes:["nuclear"], cc:"🇺🇸", nm:"Southern Company", v:"utilities", s:"Regulated", r:27000, g:30, mc:105000, pe:21, pr:"Vogtle 3 & 4 · GA/AL regulated utilities", d:"Regulated Southeast utility. Operates Vogtle 3 & 4 — the only new-build AP1000 reactors in the US in a generation. Datacenter load growth in Georgia (Meta, Google). Large dividend yield.", ri:["Vogtle cost overruns (historical)","Coal transition"], ca:["Vogtle full run rate","GA datacenter load","Rate base growth"], dc:{f:3000,gr:5,w:7,tg:2,sh:1100}, ms:{pp:.7,pl:.85,ur:.5,ai:.85}, fin:{beta:.4,eps:4.30,div:2.88,rg:[3,4,5,6,7]}, rs:[["Georgia Power",40],["Alabama Power",25],["Mississippi Power",8],["Southern Co Gas",15],["Southern Power",12]], geo:[["Georgia",42],["Alabama",30],["Mississippi",12],["Other SE",16]], tc:[["Data centers (Atlanta metro)",22],["Residential",38],["Commercial",22],["Industrial",15],["Wholesale",3]], pl:[{name:"Vogtle Units 3 & 4",desc:"Only new AP1000 reactors in US · full run 2024",pos:"Premier US nuclear new-build"},{name:"Plant Vogtle Units 1 & 2",desc:"Legacy 2-unit nuclear",pos:"Franchise"},{name:"Hatch Nuclear",desc:"2 units · GA",pos:"Base"},{name:"Farley Nuclear",desc:"2 units · AL",pos:"Base"},{name:"Southern Company Gas",desc:"7 LDC utilities · GA, IL, VA, TN",pos:"Diversification"},{name:"GA DC Alley PPAs",desc:"Meta, Google, QTS deployments",pos:"Load growth"}], cp:["D","NEE","DUK","AEP","XEL","NRG"], ops:{hq:"Atlanta, GA",fd:1945,emp:27000,ne:"Apr 2026"}, own:{insider:.1,institutional:67} },
  { t:"NRG", themes:["nuclear"], cc:"🇺🇸", nm:"NRG Energy", v:"utilities", s:"IPP", r:30000, g:18, mc:24000, pe:14, pr:"Texas merchant + retail · Vivint smart home", d:"Texas-heavy merchant power + retail electricity + Vivint smart home. Partial nuclear via South Texas Project. Benefits from ERCOT tightness and datacenter load.", ri:["Retail margin competition","Vivint integration"], ca:["ERCOT heat load","PJM capacity prices","Retail pricing power"], dc:{f:1200,gr:8,w:8,tg:2,sh:200}, ms:{pp:.9,pl:.6,ur:.2,ai:.8}, fin:{beta:1.0,eps:6.80,div:1.76,rg:[8,12,15,16,12]} },

  /* ═══════════════ NUCLEAR · SMR & ADVANCED ═══════════════ */
  { t:"OKLO", themes:["nuclear"], cc:"🇺🇸", nm:"Oklo Inc", v:"smr", s:"SMR", r:0, g:0, mc:13000, pe:null, pr:"Aurora microreactor · HALEU fuel recycling", d:"Sam Altman-backed microreactor developer (Aurora — 15-50 MWe sodium-cooled fast reactor). Pre-revenue. NRC combined license application under review. Speculative but a core AI-power narrative name.", ri:["Pre-revenue","NRC licensing uncertainty","Fuel supply (HALEU)"], ca:["NRC COLA progress","First mover in microreactor","AI datacenter MoUs"], dc:{f:-80,gr:200,w:18,tg:3,sh:125}, ms:{pp:.7,pl:.9,ur:.7,ai:.95}, fin:{beta:3.0,eps:-.65,div:0,rg:[0,0,0,100,200]}, rs:[["Pre-revenue (Aurora development)",100]], geo:[["US (NRC licensing)",100]], tc:[["MOU pipeline (14+ GW LOIs)",100]], pl:[{name:"Aurora Microreactor",desc:"15-50 MWe fast spectrum sodium-cooled reactor",pos:"Flagship"},{name:"INL Idaho site",desc:"First-of-a-kind demonstration · DOE collaboration",pos:"Lead plant site"},{name:"Nuclear fuel recycling",desc:"HALEU recycling technology · Argonne partnership",pos:"Vertical integration"},{name:"MOU pipeline",desc:"Equinix, Diamondback, Vertiv, Oklo Korea MOUs = 14+ GW",pos:"Commercial pipeline"}], cp:["SMR","NNE","BWXT","TerraPower (pvt)","X-energy (pvt)"], ops:{hq:"Santa Clara, CA",fd:2013,emp:250,ne:"May 2026"}, own:{insider:18,institutional:40} },
  { t:"SMR", themes:["nuclear"], cc:"🇺🇸", nm:"NuScale Power", v:"smr", s:"SMR", r:30, g:null, mc:3500, pe:null, pr:"VOYGR SMR (77 MWe modules)", d:"First SMR design certified by NRC (2023). UAMPS project cancelled 2024; pivoting to industrial and international customers. 12-pack VOYGR plant design.", ri:["UAMPS cancellation fallout","Project economics challenged"], ca:["International licensing","Industrial customer wins","Supply chain build-out"], dc:{f:-150,gr:100,w:18,tg:3,sh:265}, ms:{pp:.7,pl:.85,ur:.7,ai:.85}, fin:{beta:3.5,eps:-.55,div:0,rg:[-50,-20,20,80,100]}, rs:[["Engineering services (limited)",80],["DOE grants",20]], geo:[["US",60],["International (Romania, Poland, etc.)",40]], tc:[["DOE (HALEU, cost-share)",35],["International LOIs",45],["Fluor (parent)",20]], pl:[{name:"VOYGR-12",desc:"12-pack 77 MWe modules · 924 MWe plant · NRC design-certified",pos:"NRC-certified SMR"},{name:"VOYGR-6 / VOYGR-4",desc:"Smaller-footprint configurations",pos:"Flex offerings"},{name:"RoPower Romania",desc:"6-module VOYGR at Doicești · 2029 target",pos:"Lead plant"},{name:"ENTRA1 partnership",desc:"Commercialization partnership",pos:"Execution vehicle"}], cp:["OKLO","NNE","BWXT","GE Hitachi BWRX-300 (private)","TerraPower (pvt)"], ops:{hq:"Portland, OR",fd:2007,emp:550,ne:"May 2026"}, own:{insider:40,institutional:35} },
  { t:"NNE", themes:["nuclear"], cc:"🇺🇸", nm:"Nano Nuclear Energy", v:"smr", s:"Microreactor", r:0, g:0, mc:700, pe:null, pr:"Zeus · Odin microreactors · HALEU fuel line", d:"Pre-revenue microreactor startup (Zeus: solid-core battery, Odin: HPR). Also HALEU fuel development. Highly speculative with no NRC applications filed yet.", ri:["Pre-revenue","No NRC applications filed","Dilution risk"], ca:["First design filing","HALEU fuel line build-out","Retail investor momentum"], dc:{f:-30,gr:300,w:22,tg:3,sh:30}, ms:{pp:.6,pl:.9,ur:.8,ai:.85}, fin:{beta:3.5,eps:-.40,div:0,rg:[0,0,0,0,100]} },

  /* ═══════════════ NUCLEAR · FUEL CYCLE & MINERS ═══════════════ */
  { t:"LEU", themes:["nuclear"], cc:"🇺🇸", nm:"Centrus Energy", v:"enrichment", s:"Enrichment", r:430, g:22, mc:3500, pe:30, pr:"HALEU enrichment · LEU for existing reactors", d:"Sole US-owned enrichment facility (Piketon, OH). First US HALEU production facility. Beneficiary of Russian LEU ban and SMR fuel demand.", ri:["Russia ban waiver risk","Small scale vs global enrichers"], ca:["DOE HALEU contracts","Russian LEU ban implementation","SMR fuel demand"], dc:{f:30,gr:30,w:13,tg:3,sh:17}, ms:{pp:.5,pl:.9,ur:.95,ai:.7}, fin:{beta:2.2,eps:3.00,div:0,rg:[10,25,40,50,35]}, rs:[["LEU enrichment (Russian TVEL resale)",60],["HALEU pilot (DOE cost-share)",25],["Technical Services",15]], geo:[["US",90],["International (resale)",10]], tc:[["DOE (HALEU)",35],["US utilities (LEU)",50],["International utilities",15]], pl:[{name:"Piketon Ohio Enrichment",desc:"Sole US-owned centrifuge enrichment plant",pos:"Sole domestic"},{name:"HALEU Production Pilot",desc:"DOE-funded first US HALEU · targeting 900 kg/yr",pos:"First-mover"},{name:"American Centrifuge Technology",desc:"Proprietary enrichment cascades",pos:"Strategic IP"},{name:"TENEX Reseller",desc:"Russian LEU resale business · exiting as ban phases in",pos:"Declining"}], cp:["Urenco (pvt)","Orano (pvt)","TENEX (Russian)","CCJ (conversion)"], ops:{hq:"Bethesda, MD",fd:2002,emp:400,ne:"May 2026"}, own:{insider:8,institutional:50} },
  { t:"CCJ", themes:["nuclear"],   cc:"🇨🇦", nm:"Cameco Corporation", v:"miners", s:"Producer", r:3300, g:30, mc:30000, pe:75, pr:"Largest Western uranium producer · Westinghouse stake (49%)", d:"World's largest Western uranium producer (Cigar Lake, McArthur River). Owns 49% of Westinghouse (reactor services). Core pure-play on U3O8 price.", ri:["U price volatility","Kazakh competitor pricing"], ca:["Long-term contract re-pricing","Westinghouse AP1000 demand","Russia supply exit"], dc:{f:650,gr:10,w:10,tg:2,sh:435}, ms:{pp:.5,pl:.8,ur:.95,ai:.7}, fin:{beta:1.0,eps:.95,div:.12,rg:[5,12,22,25,18]}, rs:[["Uranium (mining)",72],["Fuel Services",20],["Westinghouse (49% JV equity method)",8]], geo:[["Canada (mining)",50],["US (fuel services)",25],["Europe",15],["APAC",10]], tc:[["Top utilities (EDF, KEPCO, etc.)",60],["Spot market",15],["Long-term intra-industry",15],["Westinghouse customers",10]], pl:[{name:"Cigar Lake mine",desc:"50% ownership · highest-grade uranium mine globally · Saskatchewan",pos:"Crown jewel"},{name:"McArthur River/Key Lake",desc:"70% stake · restarted 2022 · core Saskatchewan asset",pos:"Tier-1"},{name:"Inkai JV (40% w/ KAP)",desc:"Kazakhstan ISR",pos:"Low-cost vol"},{name:"Port Hope conversion",desc:"UF6 conversion · Canada fuel services",pos:"Strategic"},{name:"Westinghouse Electric (49%)",desc:"Reactor services, AP1000 · JV w/ Brookfield",pos:"Downstream integration"}], cp:["KAP","NXE","DNN","UEC","URG","PDN","BOE","UUUU"], ops:{hq:"Saskatoon, SK, Canada",fd:1988,emp:3500,bl:{label:"Contract book",val:35,unit:"B"},ne:"May 2026"}, own:{insider:1,institutional:76} },
  { t:"URG", themes:["nuclear"], cc:"🇺🇸", nm:"Ur-Energy Inc", v:"miners", s:"Producer", r:45, g:30, mc:400, pe:null, pr:"ISR uranium (Lost Creek · Shirley Basin)", d:"Small US ISR (in-situ recovery) uranium producer in Wyoming. Benefits from domestic supply premium and DOE uranium reserve purchases.", ri:["Small scale","Capex financing"], ca:["DOE reserve purchases","Lost Creek ramp","Shirley Basin restart"], dc:{f:5,gr:50,w:14,tg:3,sh:260}, ms:{pp:.4,pl:.85,ur:.95,ai:.6}, fin:{beta:2.0,eps:-.05,div:0,rg:[-20,20,60,80,50]}, rs:[["Uranium production",100]], geo:[["US (Wyoming)",100]], tc:[["US utilities (long-term)",65],["Spot",35]], pl:[{name:"Lost Creek ISR (WY)",desc:"Active production ISR facility",pos:"Primary asset"},{name:"Shirley Basin (WY)",desc:"Second mine preparing for restart 2026",pos:"Growth lever"},{name:"Long-term contracts",desc:"~1M+ lb/yr future contracted sales",pos:"Revenue visibility"}], cp:["CCJ","UEC","UUUU","DNN","PDN"], ops:{hq:"Littleton, CO",fd:2004,emp:65,ne:"May 2026"}, own:{insider:7,institutional:30} },
  { t:"UEC", themes:["nuclear"], cc:"🇺🇸", nm:"Uranium Energy Corp", v:"miners", s:"Developer", r:110, g:null, mc:3500, pe:null, pr:"ISR uranium · Physical uranium inventory", d:"US ISR uranium developer with multiple projects in Wyoming, Texas. Holds physical U3O8 inventory as strategic asset. Acquisition roll-up strategy.", ri:["Dilution risk","Roll-up execution"], ca:["Wyoming hub ramp","Physical inventory mark-up","Tier-1 producer status"], dc:{f:-20,gr:80,w:15,tg:3,sh:400}, ms:{pp:.4,pl:.85,ur:.95,ai:.65}, fin:{beta:2.3,eps:-.35,div:0,rg:[-30,30,80,100,60]}, rs:[["Uranium production",65],["Physical uranium inventory",35]], geo:[["US (TX + WY)",80],["Paraguay/Canada (developers)",20]], tc:[["US utilities (long-term)",60],["Spot market / DOE",40]], pl:[{name:"Hobson Processing Plant (TX)",desc:"Central ISR processing facility",pos:"Hub"},{name:"Palangana / Burke Hollow",desc:"TX ISR satellite mines",pos:"Production"},{name:"Christensen Ranch (WY)",desc:"Acquired from Uranium One · restarting",pos:"Growth"},{name:"Physical U3O8 Holdings",desc:"~1.36M lb inventory · strategic",pos:"Price leverage"},{name:"Anfield/Rio Cortez projects",desc:"Paraguay/Canada development",pos:"Long-term"}], cp:["CCJ","KAP","URG","PDN","BOE","UUUU","EFR"], ops:{hq:"Corpus Christi, TX",fd:2003,emp:180,ne:"May 2026"}, own:{insider:6,institutional:70} },
  { t:"DNN", themes:["nuclear"], cc:"🇨🇦", nm:"Denison Mines", v:"miners", s:"Developer", r:15, g:null, mc:1700, pe:null, pr:"Wheeler River uranium project · Athabasca Basin", d:"Athabasca Basin uranium developer (Wheeler River project). Partially funded, targeting first production late decade. High-grade but not yet in production.", ri:["No current production","Permitting timeline"], ca:["Wheeler River first production","Athabasca grade premium","Feasibility upgrades"], dc:{f:-25,gr:100,w:16,tg:3,sh:900}, ms:{pp:.3,pl:.6,ur:.95,ai:.5}, fin:{beta:2.5,eps:-.08,div:0,rg:[-40,20,100,150,80]}, rs:[["Pre-revenue (Wheeler River development)",100]], geo:[["Canada (Athabasca + McClean)",95],["Physical uranium fund",5]], tc:[["Future long-term offtake (utilities)",100]], pl:[{name:"Wheeler River (Phoenix)",desc:"Innovative ISR in Athabasca · first-of-kind",pos:"Flagship development"},{name:"McClean Lake Mill (22.5%)",desc:"Cameco/Orano JV · Cigar Lake ore processing",pos:"Cash source"},{name:"Waterbury Lake",desc:"Exploration · Athabasca",pos:"Pipeline"},{name:"Physical Uranium Holdings",desc:"DUC holding · 2.5M lb",pos:"Balance sheet"}], cp:["CCJ","NXE","UEC","PDN","BOE","KAP","URG"], ops:{hq:"Toronto, ON, Canada",fd:1997,emp:50,ne:"May 2026"}, own:{insider:2,institutional:58} },

  /* ═══════════════ NUCLEAR · ENGINEERING ═══════════════ */
  { t:"FLR", themes:["nuclear"], cc:"🇺🇸", nm:"Fluor Corporation", v:"services", s:"EPC", r:16000, g:5, mc:9000, pe:25, pr:"EPC · NuScale stake · Mission solutions", d:"Large EPC firm (Fluor) owns majority of NuScale. Strategic stake in SMR commercialization. Also LNG, mining, mission services. Diversified industrial play on energy transition.", ri:["NuScale project economics","Legacy fixed-price contract tail"], ca:["NuScale international wins","Energy transition EPC demand","Mission Solutions recompete"], dc:{f:400,gr:8,w:10,tg:2,sh:170}, ms:{pp:.5,pl:.7,ur:.6,ai:.75}, fin:{beta:1.5,eps:3.40,div:0,rg:[-5,5,8,10,10]} },
  { t:"MIR", themes:["nuclear"], cc:"🇺🇸", nm:"Mirion Technologies", v:"services", s:"Parts", r:885, g:42, mc:5200, pe:50, pr:"Radiation detection · Personal dosimeters · Plant monitoring · Medical imaging QA", d:"Pure-play radiation detection + measurement. Industrial Industrial segment (nuclear plants, defense, homeland security) + Medical segment (radiation oncology + diagnostic imaging QA). AI datacenter nuclear buildout = second wind for traditionally-cyclical nuclear safety business. Q3 2025 rally +18% on nuclear wins. ~9% revenue growth 2026 guide.", ri:["Nuclear new-build timing","Medical capex cycle","FX exposure (50% intl)"], ca:["SMR regulatory orders","Nuclear fleet life extensions","Medical oncology growth","AI-DC nuclear wins"], dc:{f:140,gr:10,w:9,tg:2,sh:225}, ms:{pp:.5,pl:.85,ur:.6,ai:.8}, fin:{beta:1.1,eps:.45,div:0,rg:[6,8,10,9,9]}, rs:[["Nuclear & Safety (industrial)",67],["Medical (oncology + imaging QA)",33]], geo:[["Americas",52],["EMEA",30],["APAC",18]], tc:[["Nuclear utilities (global)",28],["Medical providers",22],["Government / defense",14],["Industrial safety",18],["SMR developers",8],["Other",10]], pl:[{name:"Radiation Detection Systems",desc:"In-plant radiation monitoring · sole-source on most US fleet",pos:"Category leader"},{name:"Personal Dosimetry",desc:"Instadose wearable dosimeters · largest US provider",pos:"Recurring franchise"},{name:"Instrument Reactor Controls",desc:"Reactor monitoring instrumentation · SMR-qualified",pos:"SMR-relevant growth"},{name:"Medical Imaging QA",desc:"Radiation therapy QA · oncology dosimetry",pos:"Medical diversifier"},{name:"Neutron Detection",desc:"Homeland security + nuclear safeguards",pos:"Defense tailwind"},{name:"Decommissioning Services",desc:"D&D services for retiring reactors",pos:"Decadal annuity"}], cp:["Thermo Fisher (medical)","Fortive (Landauer, Ion Detection)","Bertin Technologies","Laborie Medical"], ops:{hq:"Atlanta, GA",fd:2005,emp:2800,mfg:["Oak Ridge TN","Meriden CT","Erlangen DE","Lamanon FR"],ne:"Late Apr 2026"}, own:{insider:10,institutional:75} },
  { t:"DUK", themes:["nuclear"], cc:"🇺🇸", nm:"Duke Energy Corporation", v:"utilities", s:"Regulated", r:31000, g:21, mc:95000, pe:19, pr:"McGuire · Catawba · Oconee · Harris nuclear · 8.5 GW regulated nuclear", d:"One of the largest US electric holding companies. Operates 6 nuclear units across North Carolina + South Carolina (McGuire, Catawba, Oconee, Harris) producing ~50% of NC/SC generation. First utility to contract an SMR (NuScale Carolinas). Strong regulated earnings + transmission build-out. Data center load growth 25+ GW pipeline.", ri:["Weather / storm exposure","Rate case timing","Hurricane Helene (NC) damage recovery"], ca:["Data center load growth","SMR siting (NuScale partnership)","Nuclear uprate program","Constellation power deals"], dc:{f:1500,gr:6,w:7,tg:2,sh:774}, ms:{pp:.8,pl:.9,ur:.3,ai:.85}, fin:{beta:.4,eps:5.90,div:4.18,rg:[4,5,6,7,8]}, rs:[["Electric Utilities (regulated)",88],["Gas Utilities (regulated)",11],["Commercial Renewables",1]], geo:[["North Carolina",38],["South Carolina",16],["Florida (DEF)",24],["Indiana (DEI)",11],["Kentucky/Ohio",11]], tc:[["Residential customers",41],["Commercial",30],["Industrial (incl. data centers)",26],["Wholesale + other",3]], pl:[{name:"McGuire + Catawba (NC/SC)",desc:"4 GW combined · paired 2-unit PWRs · ~$/kWh among lowest in fleet",pos:"Crown jewel nuclear"},{name:"Oconee Nuclear Station",desc:"3 units · 2.5 GW · oldest operational · license extension 2053",pos:"Long-life asset"},{name:"Harris Nuclear Plant",desc:"Single unit PWR · 900 MW · North Carolina",pos:"Base-load"},{name:"NuScale Carolinas SMR",desc:"First commercial SMR purchase agreement · 12x77MWe modules",pos:"SMR flagship"},{name:"Data center transmission buildout",desc:"500kV + 230kV expansion · $73B 5-year capex",pos:"AI-DC tailwind"},{name:"Renewables + storage pipeline",desc:"8+ GW solar / storage · grid reliability",pos:"Transition"}], cp:["NEE","SO","D","XEL","AEP"], ops:{hq:"Charlotte, NC",fd:1904,emp:27600,ne:"Early May 2026"}, own:{insider:.3,institutional:66} },
  { t:"PWR", themes:["nuclear","ai"], cc:"🇺🇸", nm:"Quanta Services Inc.", v:"services", s:"EPC", r:26300, g:17, mc:55000, pe:38, pr:"Nuclear plant services · Grid buildout · Transmission · Substation", d:"Largest US electric infrastructure + energy services contractor. Critical EPC partner for nuclear plant life extension, SMR site preparation, and massive grid transmission buildout for AI datacenters. $34B backlog. Renewable integration + long-haul HVDC specialist. Strong positioning for data center transmission buildout (10-year CAGR 10%+).", ri:["Labor inflation","Large project execution","Macro/rates cycle"], ca:["Nuclear life extensions","Grid transmission mega-buildout","Renewable EPC surge","SMR site prep demand"], dc:{f:1400,gr:12,w:9,tg:2,sh:148}, ms:{pp:.75,pl:.7,ur:.4,ai:.95}, fin:{beta:1.2,eps:9.00,div:.40,rg:[14,18,16,14,13]}, rs:[["Electric Power (utilities + nuclear + grid)",73],["Underground Utility & Infrastructure Solutions",18],["Renewable Energy",9]], geo:[["United States",87],["Canada",8],["Australia + intl",5]], tc:[["Investor-owned utilities (AEP, CEG, D, SO, etc.)",62],["Independent power producers",14],["Telecom / pipeline operators",10],["Data center developers direct",6],["Federal/state",8]], pl:[{name:"Transmission & distribution services",desc:"Design-build + construct grid · 500kV + 345kV · hurricane rebuild + data center buildout",pos:"Category leader"},{name:"Nuclear plant services",desc:"Refueling outage support · life extension · SMR site EPC",pos:"Specialty franchise"},{name:"Large-scale renewables EPC",desc:"Utility-scale solar + wind + storage · IRA tailwind",pos:"Growth vector"},{name:"Underground infrastructure",desc:"Pipeline + conduit + fiber · underground utility solutions",pos:"Diversifier"},{name:"Cupertino Electric (acquired)",desc:"Mission-critical data center electrical · key AI DC exposure",pos:"AI tailwind"},{name:"QPS (industrial + emergency response)",desc:"Storm restoration + pipe integrity",pos:"Storm-driven"}], cp:["MYR Group","MasTec (MTZ)","Dycom Industries","Emcor (EME)","Granite Construction"], ops:{hq:"Houston, TX",fd:1997,emp:60000,bl:{label:"Backlog",val:34,unit:"B"},ne:"Early May 2026"}, own:{insider:.5,institutional:91} },
  { t:"ASPI", themes:["nuclear"], cc:"🇺🇸", nm:"ASP Isotopes Inc.", v:"enrichment", s:"Enrichment", r:22, g:25, mc:1200, pe:null, pr:"Aerodynamic Separation Process (ASP) · Quantum-enrichment · HALEU + medical isotopes", d:"Specialty isotope enrichment company using Aerodynamic Separation Process + Quantum Enrichment technology. Enriched silicon-28 for quantum computing + HALEU for advanced reactors (NuScale supply deal). Medical isotopes (Mo-99 + Yb-176) growing segment. South African production facilities. Multiple DOE contracts.", ri:["Pre-commercial at scale","Tech demonstration risk","South Africa operational"], ca:["HALEU DOE contracts","Quantum enrichment scale-up","Medical isotope wins"], dc:{f:-30,gr:80,w:16,tg:3,sh:85}, ms:{pp:.3,pl:.8,ur:.85,ai:.5}, fin:{beta:2.5,eps:-.40,div:0,rg:[30,100,150,200,120]} },
  { t:"LTBR", themes:["nuclear"], cc:"🇺🇸", nm:"Lightbridge Corporation", v:"enrichment", s:"Fabrication", r:1, g:-500, mc:160, pe:null, pr:"Metallic nuclear fuel · PWR + SMR fuel · INL partnership", d:"Nuclear fuel R&D. Developing proprietary uranium-zirconium metallic nuclear fuel designed to increase existing reactor output by up to 10% and support SMR fuel cycles. Idaho National Lab partnership. US DOE fuel testing programs. Pre-revenue with speculative call-option upside.", ri:["Pre-commercial","Cash burn","Technology demonstration risk"], ca:["DOE HALEU fuel testing","SMR fuel qualification","INL fuel test reactor"], dc:{f:-20,gr:-80,w:22,tg:3,sh:15}, ms:{pp:.2,pl:.9,ur:.95,ai:.3}, fin:{beta:3.0,eps:-2.50,div:0,rg:[20,50,80,100,200]} },
  { t:"CMS", themes:["nuclear"], cc:"🇺🇸", nm:"CMS Energy Corporation", v:"utilities", s:"Regulated", r:8100, g:22, mc:23000, pe:20, pr:"Consumers Energy Michigan · Palisades restart (Holtec) · Gas + electric utility", d:"Michigan-based regulated utility. Notably hosts Palisades nuclear plant (closed 2022) being restored by Holtec — would be first US commercial reactor restart ever. CMS will be long-term offtaker via PPA. Strong Michigan regulatory environment. Accelerating renewables retirement + clean energy plan.", ri:["Palisades restart execution (Holtec)","Michigan rate case cycle"], ca:["Palisades restart 2025/26","IRA clean energy tax credits","Data center load"], dc:{f:450,gr:7,w:7,tg:2,sh:290}, ms:{pp:.7,pl:.9,ur:.3,ai:.7}, fin:{beta:.4,eps:3.50,div:2.17,rg:[4,5,6,6,7]} },
  { t:"DTE", themes:["nuclear"], cc:"🇺🇸", nm:"DTE Energy Company", v:"utilities", s:"Regulated", r:13000, g:22, mc:27000, pe:17, pr:"DTE Electric Michigan · Fermi 2 nuclear · Fermi 3 SMR potential", d:"Detroit-based regulated electric + gas utility. Operates Fermi 2 nuclear plant (1 GW boiling water reactor). Has mothballed Fermi 3 site license with potential for SMR development. Strong clean energy transformation plan. Michigan data center growth tailwind.", ri:["Fermi 2 aging refurbishment","Weather exposure","Rate case timing"], ca:["Fermi 3 SMR siting study","Data center load Michigan","Clean transformation capex"], dc:{f:600,gr:6,w:7,tg:2,sh:210}, ms:{pp:.7,pl:.85,ur:.3,ai:.75}, fin:{beta:.5,eps:6.50,div:4.24,rg:[5,6,7,6,6]} },
  { t:"J", themes:["nuclear"], cc:"🇺🇸", nm:"Jacobs Solutions Inc.", v:"services", s:"EPC", r:11900, g:24, mc:18000, pe:18, pr:"Nuclear cleanup · DOE site services · SMR engineering · Infrastructure", d:"Global EPC focused on government services + infrastructure. Major DOE nuclear cleanup contractor (Hanford, Savannah River). SMR engineering partner to multiple developers. Recent Critical Mission Solutions spinoff (Amentum) completed Sep 2024. Strong backlog at $34B. Nuclear + defense + transport infrastructure tailwinds.", ri:["Government contract timing","Cost-plus margin pressure","Amentum spinoff lingering costs"], ca:["DOE cleanup program ramp","SMR engineering wins","Water + transport infrastructure","Defense services"], dc:{f:700,gr:6,w:8,tg:2,sh:123}, ms:{pp:.6,pl:.85,ur:.4,ai:.7}, fin:{beta:.9,eps:6.00,div:1.30,rg:[4,6,8,7,6]} },

  /* ═══════════════ DRONES · PURE-PLAY ═══════════════ */
  { t:"ONDS", themes:["drones"], cc:"🇺🇸", nm:"Ondas Holdings", v:"counter", s:"RF", r:20, g:15, mc:400, pe:null, pr:"Optimus + Iron Drone Raider · Public safety autonomous", d:"Unit of Ondas Networks + American Robotics. Iron Drone Raider counter-UAS system adopted by several Middle East defense ministries. Pre-revenue in drones segment.", ri:["Pre-revenue scale","Dilution risk"], ca:["Counter-UAS orders","Rail inspection ramp"], dc:{f:-15,gr:80,w:18,tg:3,sh:130}, ms:{df:.8,re:.7,cn:.3,cf:.7}, fin:{beta:2.5,eps:-.40,div:0,rg:[-30,20,50,80,60]}, rs:[["Autonomous Drones (OAS)",70],["Ondas Networks (rail)",30]], geo:[["Israel",35],["UAE / ME",30],["US",20],["Other",15]], tc:[["Israeli MOD",25],["UAE MOD",22],["Rail operators",20],["Other defense",15],["Commercial",18]], pl:[{name:"Optimus System",desc:"Autonomous drone-in-a-box · public safety/industrial",pos:"Flagship"},{name:"Iron Drone Raider",desc:"Counter-UAS kinetic interceptor · ME fielded",pos:"Fast-growing"},{name:"Kestrel",desc:"Reconnaissance UAS · 4-hour endurance",pos:"New"},{name:"dot Platform",desc:"FullMAX wireless for rail private networks",pos:"Legacy"}], cp:["AVAV","PDYN","Skydio (pvt)","Shield AI (pvt)"], ops:{hq:"Waltham, MA",fd:2006,emp:150,ne:"May 2026"}, own:{insider:15,institutional:25} },
  { t:"RCAT", themes:["drones"], cc:"🇺🇸", nm:"Red Cat Holdings", v:"tactical", s:"Small", r:18, g:20, mc:650, pe:null, pr:"Teal 2 · Black Widow SRR", d:"Short Range Reconnaissance (SRR) drone winner for US Army. Small tactical drones competing with DJI replacement demand. Pre-profit.", ri:["Low revenue base","SRR execution risk"], ca:["Army SRR production","DJI ban beneficiary"], dc:{f:-10,gr:150,w:18,tg:3,sh:90}, ms:{df:.9,re:.6,cn:.9,cf:.7}, fin:{beta:2.8,eps:-.50,div:0,rg:[-20,50,120,180,150]}, rs:[["Teal Drones (SRR)",75],["FlightWave/Edge",15],["Other",10]], geo:[["US",92],["International",8]], tc:[["US Army (SRR)",60],["Other US DoD",20],["Foreign govts",10],["Commercial",10]], pl:[{name:"Black Widow SRR",desc:"Army Short Range Recon winner · DJI replacement",pos:"Sole-source SRR"},{name:"Teal 2",desc:"NDAA-compliant small drone · thermal + color",pos:"Active production"},{name:"Fang FPV",desc:"First-person-view tactical drone · new",pos:"New entry"},{name:"Edge 130 Blue",desc:"Edge Autonomy tethered UAS",pos:"ISR niche"}], cp:["AVAV","Skydio (pvt)","UMAC","AIRO","Shield AI (pvt)"], ops:{hq:"Puerto Rico",fd:2016,emp:120,ne:"May 2026"}, own:{insider:8,institutional:30} },
  { t:"AIRO", themes:["drones"], cc:"🇺🇸", nm:"AIRO Group Holdings", v:"tactical", s:"Medium", r:90, g:22, mc:850, pe:null, pr:"Coyote loitering · Medical drones · Avionics", d:"Integrated drone, avionics, and training services company. Coyote interceptor drone supports Ukrainian defense. Recent IPO.", ri:["IPO lockup","Integration execution"], ca:["Coyote scale","Medical drone pilot"], dc:{f:-25,gr:50,w:16,tg:3,sh:50}, ms:{df:.85,re:.5,cn:.2,cf:.8}, fin:{beta:2.2,eps:-.60,div:0,rg:[-10,30,60,70,60]}, rs:[["Electric Air Mobility",35],["Drones",30],["Avionics",20],["Training",15]], geo:[["US",60],["UK/Europe",25],["APAC",15]], tc:[["Military (various)",45],["Commercial aviation",30],["Training schools",15],["Other",10]], pl:[{name:"Coyote Loitering",desc:"Low-cost loitering munition · Ukraine-relevant",pos:"Growth"},{name:"Jackal UAS",desc:"Group 2 medium UAS",pos:"Franchise"},{name:"Training Services",desc:"Pilot training · multiple markets",pos:"Recurring"},{name:"Aspen Avionics",desc:"GA avionics subsidiary",pos:"Niche"}], cp:["AVAV","KTOS","Skydio (pvt)","Garmin (avionics)"], ops:{hq:"Reston, VA",fd:2021,emp:550,ne:"May 2026"}, own:{insider:60,institutional:20} },
  { t:"UMAC", themes:["drones"], cc:"🇺🇸", nm:"Unusual Machines", v:"counter", s:"RF", r:15, g:30, mc:200, pe:null, pr:"NDAA-compliant FPV drones · Fat Shark goggles", d:"FPV drone components and training drones. NDAA-compliant parts for defense/public safety. Don Trump Jr. advisor. Consumer + defense hybrid.", ri:["Micro-cap liquidity","Dilution"], ca:["DJI ban FPV share","DoD FPV program"], dc:{f:-5,gr:80,w:20,tg:3,sh:15}, ms:{df:.6,re:.8,cn:.9,cf:.5}, fin:{beta:3.0,eps:-.30,div:0,rg:[-20,30,80,100,70]} },
  { t:"PDYN", themes:["drones"], cc:"🇺🇸", nm:"Palladyne AI", v:"software", s:"Autonomy", r:5, g:null, mc:380, pe:null, pr:"Robotic autonomy software · Defense AI", d:"Spin-off from Sarcos. Autonomous behavior software for robots and drones. Defense AI layer play. Pre-revenue.", ri:["Pre-revenue","Dilution"], ca:["DoD software wins","Robotic autonomy partnerships"], dc:{f:-20,gr:200,w:20,tg:3,sh:30}, ms:{df:.85,re:.4,cn:.2,cf:.6}, fin:{beta:3.0,eps:-.80,div:0,rg:[0,0,50,100,150]}, rs:[["Pre-commercial (gov contracts + services)",100]], geo:[["US",95],["NATO",5]], tc:[["US DoD (PdM contracts)",65],["Energy/industrial",20],["Commercial pilots",15]], pl:[{name:"Palladyne IQ",desc:"Autonomy software for robots/drones · behavior stack",pos:"Flagship"},{name:"Palladyne Pilot",desc:"AI copilot for existing defense UAS",pos:"Fast-deploy"},{name:"Defense contracts",desc:"Army/AFWERX R&D agreements",pos:"Seed business"}], cp:["Shield AI (pvt)","Anduril (pvt)","Saronic (pvt)","Skydio (pvt)"], ops:{hq:"Salt Lake City, UT",fd:2022,emp:80,ne:"May 2026"}, own:{insider:40,institutional:18} },
  { t:"ADI", themes:["drones","robotics"], cc:"🇺🇸", nm:"Analog Devices", v:"components", s:"Vision", r:9400, g:68, mc:125000, pe:35, pr:"Mixed-signal · RF · Sensors", d:"Dominant analog + mixed-signal semiconductor maker. RF front-ends, sensor fusion, and power management go into every drone, radar, and robot. Defense + industrial mix.", ri:["Cyclical semiconductor end markets","China exposure"], ca:["Defense RF content growth","Industrial/EV/robotics cycle"], dc:{f:2500,gr:8,w:9,tg:2,sh:500}, ms:{df:.5,re:.3,cn:.5,cf:.4}, fin:{beta:1.0,eps:6.50,div:3.20,rg:[2,5,8,10,10]}, rs:[["Industrial",49],["Automotive",29],["Communications",13],["Consumer",9]], geo:[["Americas",35],["Europe",25],["China",23],["Rest of Asia",17]], tc:[["Top 10 customers",35],["Distribution channel",40],["Direct OEMs",25]], pl:[{name:"Precision Signal Processing",desc:"Data converters + amplifiers · market leader",pos:"Category dominant"},{name:"RF/Microwave",desc:"RF front-ends · 5G base station + defense radar",pos:"Differentiated"},{name:"MEMS / Inertial",desc:"Gyroscopes · navigation/drones/AV",pos:"Diversified"},{name:"Power",desc:"LTC/Linear power management IC portfolio",pos:"Strong margins"},{name:"Digital ICs",desc:"Processors + wireless connectivity",pos:"Growth"}], cp:["TXN","MCHP","STM","NXPI","MRVL","INFIY"], ops:{hq:"Wilmington, MA",fd:1965,emp:24000,ne:"Late May 2026"}, own:{insider:.2,institutional:87} },

  /* ═══════════════ SPACE · LAUNCH & SATELLITES ═══════════════ */
  { t:"ASTS", themes:["space"], cc:"🇺🇸", nm:"AST SpaceMobile", v:"satellites", s:"D2D", r:10, g:null, mc:12000, pe:null, pr:"BlueBird direct-to-device (D2D) satellites", d:"Pioneer in direct-to-device satellite-to-phone connectivity. Partnered with AT&T, Verizon, Vodafone. Constellation of 5 BlueBird satellites with 45+ planned. Pre-revenue.", ri:["Pre-revenue","Massive capex","Spectrum uncertainty"], ca:["BlueBird constellation build","Commercial service launch","FirstNet emergency services"], dc:{f:-400,gr:300,w:16,tg:3,sh:290}, ms:{do:.3,lc:.6,cm:.9,ra:.7}, fin:{beta:2.8,eps:-1.80,div:0,rg:[0,50,500,800,1000]}, rs:[["Pre-commercial (gateway/testing)",100]], geo:[["Global constellation deployment",100]], tc:[["AT&T partnership",30],["Verizon partnership",25],["Vodafone",15],["Rakuten",10],["Other MNOs (40+)",20]], pl:[{name:"BlueBird Block 1",desc:"5 commercial satellites in orbit · unfolded array",pos:"Deployed"},{name:"BlueBird Block 2",desc:"Larger antenna · higher capacity · 2026 launches",pos:"In production"},{name:"D2D (Direct-to-Device)",desc:"LTE/5G direct from phone to satellite · FirstNet",pos:"Service launch 2026"},{name:"FCC Spectrum",desc:"Premium low-band in partnership w/ MNOs",pos:"Regulatory asset"},{name:"Government / FirstNet",desc:"Emergency services · DoD interest",pos:"Adjacent revenue"}], cp:["IRDM","SATS (EchoStar)","Starlink Direct (SpaceX pvt)","Globalstar"], ops:{hq:"Midland, TX",fd:2017,emp:700,ne:"May 2026"}, own:{insider:15,institutional:60} },
  { t:"IRDM", themes:["space"], cc:"🇺🇸", nm:"Iridium Communications", v:"satellites", s:"LEO Constellation", r:830, g:75, mc:3200, pe:22, pr:"66-satellite LEO · L-band global voice/data", d:"Operational 66-satellite LEO constellation providing global voice, data, and IoT connectivity. Prime government/DoD user. Pays dividend.", ri:["Single-constellation risk","Competition from Starlink"], ca:["IoT subscriber growth","DoD renewals","PNT service launch"], dc:{f:420,gr:5,w:9,tg:2,sh:115}, ms:{do:.6,lc:.2,cm:.7,ra:.4}, fin:{beta:1.1,eps:.80,div:.56,rg:[4,7,8,9,9]}, rs:[["Commercial Services",72],["Government Services",18],["Equipment",7],["Engineering Services",3]], geo:[["North America",50],["Europe",20],["APAC",15],["ROW",15]], tc:[["DoD (EMSS)",18],["Maritime",22],["Aviation",15],["IoT commercial",25],["Broadband/consumer",12],["Other",8]], pl:[{name:"Iridium NEXT",desc:"66-satellite LEO · operational · global L-band",pos:"Sole operator"},{name:"Certus (broadband)",desc:"Certus 9770 · L-band broadband · maritime/aero",pos:"Growth"},{name:"DoD EMSS",desc:"Enhanced Mobile Satellite Services · DoD usage",pos:"Recurring gov"},{name:"IoT Network",desc:"2.3M+ subscribers · IIoT growth",pos:"Volume driver"},{name:"PNT service",desc:"GPS backup · new launch",pos:"Emerging"}], cp:["Globalstar","Inmarsat (Viasat)","ASTS","Starlink (pvt)"], ops:{hq:"McLean, VA",fd:2000,emp:720,ne:"Apr 2026"}, own:{insider:.5,institutional:92} },
  { t:"PL", themes:["space"], cc:"🇺🇸", nm:"Planet Labs", v:"eo_sar", s:"EO", r:240, g:55, mc:1800, pe:null, pr:"Dove + SkySat EO constellation · PlanetScope", d:"Largest EO satellite constellation (200+ satellites imaging Earth daily). Subscription SaaS model. Defense + commercial. NATO and Ukraine contracts.", ri:["Path to profitability","Customer concentration"], ca:["DoD contract expansion","AI analytics layer","Ukraine/NATO demand"], dc:{f:-30,gr:12,w:13,tg:3,sh:285}, ms:{do:.7,lc:.2,cm:.7,ra:.5}, fin:{beta:2.0,eps:-.25,div:0,rg:[5,12,15,18,20]}, rs:[["Commercial",55],["Civil Government",25],["Defense",20]], geo:[["North America",45],["Europe",20],["APAC",20],["ROW",15]], tc:[["NRO / Intel",18],["NGA",12],["Agribusiness",15],["NATO / Ukraine",10],["ESG/Forestry",12],["Commercial",33]], pl:[{name:"Dove Constellation",desc:"200+ smallsat SuperDoves · daily EO coverage",pos:"#1 revisit rate"},{name:"SkySat",desc:"Sub-meter HD imaging · 21 satellites",pos:"Hi-res fleet"},{name:"Pelican (next-gen)",desc:"Sub-30cm resolution · first 2 in orbit",pos:"Future leader"},{name:"Tanager Hyperspectral",desc:"Hyperspectral · methane leak detection + defense",pos:"New offering"},{name:"Planet Insights Platform",desc:"AI-driven analytics layer",pos:"SaaS expansion"}], cp:["BKSY","MAXR","SPIR","ICEYE (pvt)","Capella (pvt)"], ops:{hq:"San Francisco, CA",fd:2010,emp:1100,bl:{label:"Backlog",val:600,unit:"M"},ne:"May 2026"}, own:{insider:6,institutional:70} },
  { t:"SPIR", themes:["space"], cc:"🇺🇸", nm:"Spire Global", v:"eo_sar", s:"SAR", r:110, g:55, mc:300, pe:null, pr:"LEMUR smallsats · RF + weather + ADS-B data", d:"Radio-frequency constellation tracking aviation, maritime, and weather data. Defense + commercial customers. Smaller than Planet but data monetization is growing.", ri:["Small scale","Cash burn"], ca:["Weather data contract expansion","DoD intel contracts"], dc:{f:-20,gr:20,w:14,tg:3,sh:50}, ms:{do:.75,lc:.2,cm:.7,ra:.6}, fin:{beta:2.4,eps:-.80,div:0,rg:[5,15,20,25,25]}, rs:[["Space Services (data subscriptions)",65],["Space Services (Space-as-a-Service)",35]], geo:[["North America",45],["Europe",25],["APAC",20],["ROW",10]], tc:[["US Govt (NRO/NOAA/DoD)",28],["NOAA (weather)",18],["Maritime operators",18],["NATO/allied govts",12],["Aviation",14],["Other",10]], pl:[{name:"LEMUR-2 Constellation",desc:"~160 smallsats · RF + weather + AIS + ADS-B",pos:"Largest RF constellation"},{name:"NOAA/EUMETSAT weather",desc:"GNSS-RO radio occultation data · NOAA contract",pos:"Recurring"},{name:"Maritime AIS",desc:"Ship tracking · premium subscription",pos:"Franchise"},{name:"Space Services (SSaaS)",desc:"White-label constellations for govts",pos:"Growth"}], cp:["PL","BKSY","IRDM","MAXR"], ops:{hq:"Vienna, VA",fd:2012,emp:390,bl:{label:"Backlog",val:213,unit:"M"},ne:"May 2026"}, own:{insider:2,institutional:35} },
  { t:"BKSY", themes:["space"], cc:"🇺🇸", nm:"BlackSky Technology", v:"eo_sar", s:"EO", r:110, g:60, mc:500, pe:null, pr:"Global intelligence EO satellites · 1m resolution", d:"High-cadence EO constellation with AI-driven tasking. Major US National Reconnaissance Office (NRO) and allied intel customer. Classified contracts.", ri:["Lumpy classified contracts","Cash burn"], ca:["Gen-3 satellite launch","NRO recurring contracts"], dc:{f:-10,gr:30,w:14,tg:3,sh:140}, ms:{do:.9,lc:.3,cm:.5,ra:.5}, fin:{beta:2.5,eps:-.45,div:0,rg:[10,25,30,35,30]}, rs:[["Imagery subscriptions + tasking",75],["Geospatial Services",20],["Professional Services",5]], geo:[["US",72],["International allies",22],["Commercial intl",6]], tc:[["NRO",28],["NGA",22],["DoD (other)",15],["International allies",15],["Commercial",20]], pl:[{name:"Gen-2 Smallsats",desc:"Commercial sub-meter EO · 15-min revisit",pos:"Operational"},{name:"Gen-3 Constellation",desc:"First 2 launched · higher cadence · 2026 scale",pos:"Growth engine"},{name:"Spectra AI Platform",desc:"AI-driven anomaly detection + alerting",pos:"Software layer"},{name:"NRO EOCL",desc:"5-yr NRO task order · classified",pos:"Flagship contract"}], cp:["PL","MAXR","SPIR","ICEYE (pvt)","Capella (pvt)"], ops:{hq:"Herndon, VA",fd:2014,emp:300,bl:{label:"Backlog",val:420,unit:"M"},ne:"May 2026"}, own:{insider:15,institutional:55} },
  { t:"MAXR", themes:["space"], cc:"🇺🇸", nm:"Maxar Intelligence", v:"eo_sar", s:"EO", r:1900, g:30, mc:5500, pe:null, pr:"WorldView EO · Geospatial intelligence", d:"Largest commercial high-resolution EO provider. Private after 2023 go-private by Advent. Modeled here as public-equivalent. Premier NGA customer.", ri:["Private status (proxy)","Capex intensity"], ca:["WorldView Legion launch","NGA EOCL contract","Ukraine intel"], dc:{f:250,gr:10,w:10,tg:2,sh:75}, ms:{do:.9,lc:.2,cm:.4,ra:.4}, fin:{beta:1.5,eps:-.50,div:0,rg:[5,8,10,12,12]}, rs:[["Earth Intelligence",55],["Space Infrastructure",45]], geo:[["US Government",65],["International defense",20],["Commercial",15]], tc:[["NGA (EOCL)",38],["NRO",18],["Intl MOD (UK, Japan, etc.)",18],["Commercial",16],["Other DoD",10]], pl:[{name:"WorldView Legion",desc:"Next-gen hi-res EO · 6 satellites launched 2024",pos:"Commercial leader"},{name:"EOCL 10-yr NGA",desc:"$3.2B decade-long NGA contract",pos:"Cornerstone"},{name:"Space Infrastructure",desc:"Satellite buses · SSL legacy · propulsion",pos:"Component business"},{name:"SATCOM payloads",desc:"Commercial satellite manufacturing",pos:"Lumpy revenue"}], cp:["PL","BKSY","LMT","NOC","Airbus Defense & Space"], ops:{hq:"Westminster, CO",fd:2017,emp:2800,bl:{label:"Backlog",val:1.8,unit:"B"},ne:"Private proxy"}, own:{insider:95,institutional:5} },
  { t:"AJRD", themes:["space"], cc:"🇺🇸", nm:"Aerojet Rocketdyne (L3H)", v:"components", s:"Propulsion", r:2300, g:12, mc:5000, pe:null, pr:"Solid rocket motors · Space propulsion", d:"Solid rocket motor supplier for missiles (RS-25 for SLS, every tactical missile motor). Now owned by L3Harris (LHX). Modeled here as standalone pure-play.", ri:["Owned by LHX (proxy)","Bottleneck in motor capacity"], ca:["Motor capacity expansion","SLS/commercial launch demand"], dc:{f:200,gr:8,w:10,tg:2,sh:80}, ms:{do:.85,lc:.7,cm:.3,ra:.4}, fin:{beta:1.0,eps:2.00,div:0,rg:[3,5,8,10,10]}, rs:[["Aerospace Systems (missiles/space)",88],["Defense (other)",12]], geo:[["US Govt",95],["International",5]], tc:[["US DoD (missiles)",55],["NASA (SLS/Artemis)",22],["Prime integrators (LMT/RTX/NOC)",18],["Other",5]], pl:[{name:"Solid Rocket Motors",desc:"Missile propulsion · every major DoD missile",pos:"Sole-source bottleneck"},{name:"RS-25 Engines",desc:"NASA SLS main engine · re-supply contract",pos:"Space flagship"},{name:"RL10",desc:"Upper-stage LH2/LOX · ULA Centaur · lunar missions",pos:"Franchise"},{name:"AR1",desc:"Kerosene-LOX booster engine",pos:"Development"}], cp:["LMT","NOC","Blue Origin (pvt)","SpaceX (pvt)","Northrop SRM"], ops:{hq:"El Segundo, CA (L3Harris sub)",fd:1942,emp:5000,ne:"Private via LHX"}, own:{insider:100,institutional:0} },
  { t:"ROK", themes:["space","robotics"], cc:"🇺🇸", nm:"Rockwell Automation", v:"components", s:"Structures", r:8500, g:40, mc:33000, pe:26, pr:"Industrial automation · Control systems", d:"Industrial automation leader. Control systems, PLCs, and software (FactoryTalk). Robotics + manufacturing pivot. Cross-listed robotics/space for component role.", ri:["Industrial cycle","Software transition"], ca:["Autonomous manufacturing","Robotics cycle recovery"], dc:{f:1200,gr:4,w:9,tg:2,sh:112}, ms:{do:.2,lc:.1,cm:.4,ra:.4,la:.8,ai:.6,mfg:.9}, fin:{beta:1.1,eps:9.20,div:5.00,rg:[1,3,5,6,6]}, rs:[["Intelligent Devices",48],["Software & Control",28],["Lifecycle Services",24]], geo:[["North America",58],["Europe",22],["APAC",14],["LatAm",6]], tc:[["Automotive & Tire",18],["Food & Beverage",18],["Oil & Gas",12],["Life Sciences",12],["Semi",8],["Other industrial",32]], pl:[{name:"Logix Controllers",desc:"PLCs · flagship ControlLogix/CompactLogix",pos:"Category leader"},{name:"FactoryTalk Software",desc:"HMI + MES + analytics · Plex (recent acq)",pos:"Digital thread"},{name:"Kalypso Consulting",desc:"Digital transformation services",pos:"Accelerator"},{name:"Motion Controls",desc:"Servo drives + motors",pos:"Franchise"},{name:"Emulate3D",desc:"Digital twin simulation",pos:"Emerging"}], cp:["SIEGY","SCHN","EMR","HON","ABBNY"], ops:{hq:"Milwaukee, WI",fd:1903,emp:28000,ne:"May 2026"}, own:{insider:.1,institutional:80} },

  /* ═══════════════ ROBOTICS · HUMANOID & INDUSTRIAL ═══════════════ */
  { t:"TSLA", themes:["robotics","batteries"], cc:"🇺🇸", nm:"Tesla Inc", v:"humanoid", s:"Bipedal", r:94820, g:18, mc:1000000, pe:95, pr:"Optimus humanoid · Dojo · 4680 cells · FSD", d:"Largest humanoid robot developer (Optimus). Also cell maker via 4680s. Multi-theme: Robotics (Optimus), Batteries (Megapack, 4680). FSD/AI narrative.", ri:["Humanoid execution risk","EV margin pressure"], ca:["Optimus deployment at Tesla factories","Megapack growth","Robotaxi/FSD"], dc:{f:7000,gr:20,w:12,tg:3,sh:3200}, ms:{la:.9,ai:.95,mfg:.95,ra:.5,li:.9,ev:.95,gr:.7,cn:.6}, fin:{beta:2.3,eps:3.80,div:0,rg:[10,20,25,20,20]}, rs:[["Automotive",73],["Energy Storage (Megapack)",14],["Services & Other",13]], geo:[["North America",50],["China",22],["Europe",18],["ROW",10]], tc:[["Direct to consumer (retail)",85],["Fleet / ride-hail",6],["Government / municipal",4],["Wholesale",5]], pl:[{name:"Model Y",desc:"Mid-size crossover · best-selling EV globally",pos:"#1 global EV"},{name:"Model 3",desc:"Refreshed 2024 · premium sedan",pos:"Franchise"},{name:"Cybertruck",desc:"Light truck · ~40k units/yr",pos:"Ramping"},{name:"Model S/X",desc:"Premium · aging platform",pos:"Declining"},{name:"Megapack",desc:"Utility-scale BESS · Lathrop + Shanghai · 40+ GWh capacity",pos:"Fastest-growing segment"},{name:"Optimus",desc:"Humanoid robot · Gen 3 in production Jan 2026",pos:"Lead humanoid story"},{name:"FSD / Robotaxi",desc:"Robotaxi launched Austin 2025 · Cybercab unveiled 2024",pos:"Core AI narrative"},{name:"Dojo",desc:"Custom AI training chip · D1 tile",pos:"Internal training"}], cp:["BYD","GM","F","RIVN","LCID","NIO","VWAGY","STLA","FANUY"], ops:{hq:"Austin, TX",fd:2003,emp:140000,mfg:["Fremont CA","Austin TX","Shanghai","Berlin"],bl:{label:"Energy backlog",val:28,unit:"B"},ne:"Late Apr 2026"}, own:{insider:13,institutional:48} },
  { t:"SYM", themes:["robotics"], cc:"🇺🇸", nm:"Symbotic Inc", v:"logistics", s:"Sortation", r:1700, g:20, mc:20000, pe:null, pr:"Warehouse automation robots · Walmart flagship customer", d:"Walmart-backed warehouse automation leader. Autonomous case-handling robots. Walmart is 90%+ of revenue. Greenland logistics JV.", ri:["Walmart concentration (90%+)","Margin pressure"], ca:["Greenland JV rollout","Walmart deployment acceleration"], dc:{f:-100,gr:50,w:12,tg:3,sh:580}, ms:{la:.95,ai:.8,mfg:.7,ra:.3}, fin:{beta:2.0,eps:-.20,div:0,rg:[30,50,70,70,50]}, rs:[["Systems (hardware+software)",88],["Software & Services (SaaS)",8],["Operations & Services",4]], geo:[["US",93],["Canada",5],["Mexico",2]], tc:[["Walmart",88],["GreenBox JV (Symbotic+SoftBank)",8],["Other (Target, C&S)",4]], pl:[{name:"Symbotic System",desc:"AI-enabled case handling · autonomous robots · SymBot",pos:"Walmart-wide rollout"},{name:"GreenBox Systems",desc:"Third-party-logistics JV with SoftBank · $7.5B GMV target",pos:"Expansion vector"},{name:"SoftwarePlatform",desc:"OptimiCase · inventory/orchestration SaaS",pos:"ARR builder"},{name:"Walmart Consolidation Centers",desc:"42 deployed · 2027 complete",pos:"Cornerstone"}], cp:["AutoStore (private)","Dematic/KION","Berkshire Grey (private)","Locus Robotics (private)"], ops:{hq:"Wilmington, MA",fd:2007,emp:2100,bl:{label:"Backlog",val:22.4,unit:"B"},ne:"May 2026"}, own:{insider:55,institutional:35} },
  { t:"KSCP", themes:["robotics"], cc:"🇺🇸", nm:"Knightscope", v:"humanoid", s:"Dexterous", r:14, g:30, mc:50, pe:null, pr:"Autonomous security robots (K5, K3)", d:"Autonomous security robots as a service. Micro-cap with speculative appeal. Not a true humanoid but proxy for mobile autonomous platforms.", ri:["Micro-cap liquidity","Dilution"], ca:["Subscription scaling","Defense interest"], dc:{f:-8,gr:30,w:22,tg:3,sh:10}, ms:{la:.7,ai:.7,mfg:.3,ra:.4}, fin:{beta:3.5,eps:-1.00,div:0,rg:[-30,10,30,50,60]} },
  { t:"YASKY", themes:["robotics"], cc:"🇯🇵", nm:"Yaskawa Electric (ADR)", v:"industrial", s:"Arms", r:3450, g:24, mc:7000, pe:18, pr:"Motoman robots · Servo motors · Inverter drives · GP/AR series", d:"Japanese Big 4 industrial robot OEM (alongside FANUC, ABB, KUKA). 500,000+ Motoman robots installed globally. Three segments: Motion Control (servo systems), Robotics, and System Engineering. Strong China/auto exposure. NVIDIA Omniverse partner for next-gen physical AI training. Cobot push via HC series.", ri:["Auto cycle","JPY/USD FX","China demand"], ca:["Humanoid component supply","NVIDIA Omniverse integration","Cobot HC30 ramp","EV factory automation"], dc:{f:280,gr:6,w:9,tg:2,sh:266}, ms:{la:.85,ai:.7,mfg:.95,ra:.5}, fin:{beta:1.1,eps:1.20,div:.40,rg:[5,8,10,8,6]}, rs:[["Motion Control (servos + drives)",53],["Robotics (Motoman)",36],["System Engineering",11]], geo:[["Japan",30],["China",25],["Americas",18],["Europe",14],["Other Asia",13]], tc:[["Auto OEMs (Toyota, GM, Tesla, etc.)",36],["Electronics manufacturing",22],["Machine builders",18],["Logistics/warehousing",10],["Other industrial",14]], pl:[{name:"Motoman GP/AR series",desc:"Industrial 6-axis arms · 8-300kg payload · auto + welding workhorse",pos:"Category leader"},{name:"HC series cobots",desc:"Collaborative arms · HC10/20/30 · safe for human collaboration",pos:"Growth vector"},{name:"Sigma-7/X servo systems",desc:"AC servo motors + drives · industry-standard motion control",pos:"Franchise"},{name:"NVIDIA Omniverse partnership",desc:"Physical AI training · Isaac Sim integration · humanoid roadmap",pos:"Strategic"},{name:"Inverter drives + motion controllers",desc:"Variable frequency drives · machine builders + EV manufacturing",pos:"Diversifier"}], cp:["FANUY","ABBNY","KUKAF","KWHIY","DNZOY","Mitsubishi Electric"], ops:{hq:"Kitakyushu, Japan",fd:1915,emp:14600,ne:"Early Apr 2026"}, own:{insider:1,institutional:48} },
  { t:"CGNX", themes:["robotics","ai"], cc:"🇺🇸", nm:"Cognex Corporation", v:"vision", s:"Vision", r:870, g:73, mc:6500, pe:50, pr:"In-Sight 2D/3D vision · DataMan barcode · machine vision software", d:"#1 US machine vision company. 2D/3D imaging systems guide robots, inspect parts, read barcodes, monitor production. Apple is #1 customer (~10% of revenue). Heavy auto + consumer electronics exposure. Recovering from 2022-2024 cyclical trough. AI vision (deep learning) growing 40%+. Logistics + EV manufacturing tailwinds.", ri:["Apple concentration","Auto/consumer electronics cycle","Keyence competition"], ca:["EV battery production ramp","Logistics automation continuation","AI vision adoption","2026 industrial recovery"], dc:{f:160,gr:8,w:9,tg:2,sh:170}, ms:{la:.7,ai:.85,mfg:.95,ra:.5}, fin:{beta:1.5,eps:.65,div:.32,rg:[-12,-5,8,18,22]}, rs:[["Modular Vision Systems (In-Sight)",55],["Smart Cameras + 3D",24],["DataMan ID readers",13],["Vision software (VisionPro)",8]], geo:[["Americas",37],["EMEA",26],["Greater China",20],["Other Asia",17]], tc:[["Apple (manufacturing)",10],["Auto OEMs + tier-1",18],["Logistics (Amazon, FedEx, etc.)",16],["Consumer electronics",14],["Semiconductors",10],["Other industrial",32]], pl:[{name:"In-Sight 2800 / 3800",desc:"Edge AI smart cameras · deep learning on-device · PLC integration",pos:"Flagship"},{name:"DataMan 380/580",desc:"Industrial barcode/ID readers · logistics workhorse",pos:"Category leader"},{name:"3D Vision (3D-A1000)",desc:"3D laser profilers · automotive + battery inspection",pos:"Growth vector"},{name:"VisionPro Deep Learning",desc:"Software-based defect detection · AI/ML model deployment",pos:"AI vector"},{name:"Mounted vision systems (large area)",desc:"In-Sight 9000 series · large field-of-view · auto body inspection",pos:"Specialty"}], cp:["KYCCF","Basler (BSL.DE)","Hexagon (HXGBY)","Keyence (KYCCF)","Sick AG"], ops:{hq:"Natick, MA",fd:1981,emp:2200,ne:"Early May 2026"}, own:{insider:.5,institutional:90} },
  { t:"KYCCF", themes:["robotics","ai"], cc:"🇯🇵", nm:"Keyence Corporation (ADR)", v:"vision", s:"Sensors", r:7800, g:80, mc:78000, pe:35, pr:"Photoelectric sensors · Machine vision · Laser markers · Measurement", d:"Japan's most profitable industrial company. 80%+ gross margins via direct-sales model and proprietary tech. World #1 in many sensor + machine vision categories. Major Apple supplier. Fabless model — designs in Japan, manufactures globally. Insanely consistent: 30+ years of growing earnings. Cobot/humanoid sensor opportunity emerging.", ri:["Cyclical capex exposure","JPY strength","Premium valuation"], ca:["China factory automation","Auto + EV inspection","AI vision adoption","Humanoid sensor demand"], dc:{f:3200,gr:6,w:7,tg:2,sh:240}, ms:{la:.85,ai:.7,mfg:.95,ra:.5}, fin:{beta:.9,eps:13.50,div:1.20,rg:[12,8,5,4,8]}, rs:[["Sensors (photoelectric, prox, fiber)",38],["Machine Vision",27],["Measurement Instruments",18],["Laser Markers",10],["Microscopes + Other",7]], geo:[["Japan",35],["Americas",24],["Greater China",17],["Europe",13],["Other Asia",11]], tc:[["Auto + tier-1 suppliers",24],["Electronics manufacturing",22],["Semiconductors",14],["Pharmaceuticals/medical",10],["Apple",6],["Other industrial",24]], pl:[{name:"FS Series Fiber Sensors",desc:"World leader in fiber optic sensors · sub-millisecond response",pos:"Category dominant"},{name:"IV3 Smart Vision Sensor",desc:"AI-powered vision sensor · zero-program inspection",pos:"AI vector"},{name:"VisionMaster (CV-X) Vision Systems",desc:"Industrial machine vision · deep learning capable",pos:"Franchise"},{name:"MD Series Laser Markers",desc:"Industrial laser engraving + marking · auto/elec",pos:"Premium franchise"},{name:"VHX Digital Microscopes",desc:"4K digital microscopes · medical/research",pos:"Specialty growth"}], cp:["CGNX","Sick AG","Banner Engineering (pvt)","Omron (OMRNY)","Panasonic"], ops:{hq:"Osaka, Japan",fd:1974,emp:11200,ne:"Late May 2026"}, own:{insider:13,institutional:38} },
  { t:"SYK", themes:["robotics","biotech"], cc:"🇺🇸", nm:"Stryker Corporation", v:"surgical", s:"Orthopedic", r:23500, g:65, mc:130000, pe:30, pr:"Mako SmartRobotics · Joint replacement · Trauma · Endoscopy", d:"#2 medical device company globally. Mako robotic-arm system for knee/hip/shoulder/spine — drives premium implant pricing. ExitusGuide for FDA-cleared spine surgery. 2024 expansion to soft tissue. Strong organic growth supercycle from aging population. 11.1% Q2 25 sales growth, raised FY25 guide to 9.5-10% organic.", ri:["Hospital capex","Ortho cycle","Soft tissue execution risk"], ca:["Mako spine + shoulder ramp","Soft tissue robot pipeline","International Mako penetration"], dc:{f:3800,gr:14,w:8,tg:2,sh:380}, ms:{la:.4,ai:.6,mfg:.5,ra:.6}, fin:{beta:1.0,eps:13.00,div:3.36,rg:[10,11,12,11,10]}, rs:[["MedSurg & Neurotechnology (incl. Mako)",53],["Orthopaedics (joints + trauma)",47]], geo:[["United States",73],["International",27]], tc:[["US Hospitals",58],["Outpatient surgery centers",18],["European hospitals",14],["Asia-Pacific hospitals",10]], pl:[{name:"Mako SmartRobotics (Knee)",desc:"Robot-assisted joint replacement · 3,000+ installed · halo product",pos:"Category leader"},{name:"Mako Total Knee 2.0",desc:"Updated platform · CT-based planning · AccuStop haptic feedback",pos:"Refresh"},{name:"Mako Spine + Shoulder",desc:"FDA cleared 2024 · expanding indications",pos:"Growth vector"},{name:"Triathlon Knee + Mako-paired implants",desc:"Premium knee implants paired with Mako · pricing power",pos:"Halo flywheel"},{name:"Q Guidance",desc:"Autonomous navigation system · pre-Mako pathway",pos:"Funnel"},{name:"Neurovascular + Endoscopy",desc:"Diversified MedSurg portfolio",pos:"Stable franchise"}], cp:["MDT","ISRG","Zimmer Biomet","JNJ DePuy Synthes","Smith & Nephew"], ops:{hq:"Kalamazoo, MI",fd:1941,emp:54000,ne:"Late Apr 2026"}, own:{insider:.3,institutional:80} },
  { t:"MDT", themes:["robotics","biotech"], cc:"🇮🇪", nm:"Medtronic plc", v:"surgical", s:"Soft Tissue", r:33000, g:65, mc:130000, pe:25, pr:"Hugo RAS soft tissue · Cardiac · Diabetes · Neuromodulation", d:"World's largest medical device company. Hugo Robotic-Assisted Surgery (RAS) system competes with ISRG da Vinci in soft tissue — 2025 US launch. Heart valves, pacemakers, insulin pumps, spine implants. Mature dividend payer transitioning toward higher-growth surgical robotics + diabetes (646G) + AFib ablation (PulseSelect PFA). Recent split of Diabetes business announced 2025.", ri:["Hugo execution vs da Vinci","Diabetes spinoff distraction","Margin pressure"], ca:["Hugo US ramp","PulseSelect PFA cardiac","Diabetes spinoff (2025-26)","Affera Sphere PFA"], dc:{f:5500,gr:5,w:7,tg:2,sh:1290}, ms:{la:.4,ai:.55,mfg:.5,ra:.6}, fin:{beta:.8,eps:5.80,div:2.84,rg:[3,4,4,5,5]}, rs:[["Cardiovascular",36],["Medical Surgical (incl. Hugo)",27],["Neuroscience",28],["Diabetes",9]], geo:[["United States",51],["Western Europe",17],["Other Developed",13],["Emerging Markets",19]], tc:[["US Hospitals",49],["European hospitals",18],["Japan + Korea",10],["China + APAC",12],["LATAM/MEA",11]], pl:[{name:"Hugo RAS",desc:"Robotic-assisted soft tissue surgery · US launched 2025 · ISRG competitor",pos:"Strategic challenger"},{name:"PulseSelect / Sphere PFA",desc:"Pulsed field ablation for AFib · catheter platform",pos:"Hot growth"},{name:"MiniMed 780G/MiniMed Sync (Diabetes)",desc:"Hybrid closed-loop insulin · being spun off 2026",pos:"Spinoff"},{name:"CoreValve Evolut TAVR",desc:"Transcatheter aortic valve · Edwards competitor",pos:"Franchise"},{name:"Spine + Cranial Robotics (Mazor X)",desc:"Mazor robotic spine + StealthStation",pos:"Growth"},{name:"Inspire Sleep Apnea Implant",desc:"Hypoglossal nerve stimulator",pos:"Niche growth"}], cp:["JNJ","ABT","BSX","ISRG","SYK","Edwards Lifesciences","Abiomed (now JNJ)"], ops:{hq:"Dublin, Ireland",fd:1949,emp:95000,ne:"Late May 2026"}, own:{insider:.3,institutional:84} },
  { t:"HSAI", themes:["robotics","drones"], cc:"🇨🇳", nm:"Hesai Group", v:"vision", s:"Lidar", r:340, g:48, mc:2400, pe:null, pr:"AT128/AT512 lidars · Robotics lidars · ADAS automotive lidars", d:"World's #1 lidar maker by revenue and shipments. Major automotive ADAS supplier (Li Auto, BYD, XPeng). Pivoting to robotics + humanoids — launched ultra-compact 360°×189° lidars Q1 2025 for humanoid blind-spot-free perception. Partnerships with multiple humanoid makers including ROBOTERA. Profitable now (Q4 25 first quarterly profit). Patent portfolio expanded via Swiss IP acquisition (FTX solid-state lidar).", ri:["Chinese tech sanctions","Auto lidar pricing pressure","Solid-state lidar transition"], ca:["Humanoid robot lidar adoption","Solid-state FTX commercialization","Auto lidar volume scale-up","Quadruped + AMR demand"], dc:{f:50,gr:65,w:14,tg:3,sh:140}, ms:{la:.6,ai:.85,mfg:.7,ra:.5}, fin:{beta:2.5,eps:.10,div:0,rg:[55,70,80,55,40]}, rs:[["Automotive ADAS lidar",70],["Robotics + AMR",16],["Industrial / surveying",10],["Defense + other",4]], geo:[["China",78],["Americas",10],["Europe",7],["Other Asia",5]], tc:[["Li Auto",24],["BYD",17],["XPeng",10],["Other Chinese OEMs",24],["Robotics + humanoid customers",13],["Other",12]], pl:[{name:"AT128 / AT512 (Long-range ADAS)",desc:"Forward auto lidar · 200m range · Li Auto + XPeng standard",pos:"Auto leader"},{name:"JT-series Robotics Lidar",desc:"Ultra-compact 360°×189° hemispherical · humanoid + AMR perception",pos:"New growth vector"},{name:"FTX Solid-State Lidar",desc:"Next-gen solid-state via Swiss IP · 2026 launch · cost down",pos:"Strategic"},{name:"PandarXT (Industrial)",desc:"Mid-range scanning lidar · surveying + AMR",pos:"Franchise"},{name:"Mech Pandar (Long range L4)",desc:"Robotaxi-grade lidar · Waymo + Cruise alternative",pos:"Premium"}], cp:["Innoviz (INVZ)","Luminar (LAZR)","Ouster (OUST)","Aeva","Valeo","Bosch (pvt)"], ops:{hq:"Shanghai, China",fd:2014,emp:1900,ne:"Mid May 2026"}, own:{insider:34,institutional:30} },
  { t:"EH", themes:["drones"], cc:"🇨🇳", nm:"EHang Holdings", v:"evtol", s:"Air Taxi", r:80, g:55, mc:1800, pe:null, pr:"EH216-S autonomous eVTOL · World's first type-certified passenger eVTOL", d:"Chinese pioneer in autonomous eVTOL. EH216-S received world's first standard eVTOL Type Certificate (Oct 2023) and Production Certificate (Apr 2024) from CAAC. Now scaling commercial passenger ops in Guangzhou + Hefei. Saudi Arabia + UAE expansion. Operates as 'autonomous flight ride-share' service. Two-passenger autonomous design (no pilot) sets it apart from JOBY/ACHR.", ri:["China consumer adoption pace","Cash burn","Saudi/UAE deal execution"], ca:["Commercial passenger ops scale-up","International orders (KSA, UAE, Brazil)","VT35 long-range eVTOL"], dc:{f:-30,gr:55,w:14,tg:3,sh:55}, ms:{df:.2,re:.7,cn:.95,cf:.3}, fin:{beta:2.5,eps:-.40,div:0,rg:[40,80,55,45,40]}, rs:[["Aircraft Sales (EH216-S)",78],["Aerial Operations Services",16],["Other (parts/training)",6]], geo:[["China",58],["Middle East (KSA + UAE)",22],["Asia ex-China",10],["Other",10]], tc:[["Chinese tour operators",36],["Government / municipal demos",24],["Saudi sovereign + tourism",16],["UAE smart city pilots",10],["Other commercial",14]], pl:[{name:"EH216-S Passenger eVTOL",desc:"Autonomous 2-seat air taxi · 35km range · 130 km/h · TC certified",pos:"Flagship product"},{name:"EH216-F Firefighting variant",desc:"High-altitude firefighting · pumps + thermal imaging · niche use",pos:"Specialty"},{name:"EH216-L Logistics variant",desc:"220kg payload eVTOL cargo · last-mile delivery",pos:"Growth vector"},{name:"VT-35 Tilt-rotor (development)",desc:"300km range · 5-passenger long-range · target 2027",pos:"Roadmap"},{name:"Vertiport infrastructure",desc:"GHTaxi service operations · Guangzhou + Hefei pilot routes",pos:"Service layer"}], cp:["JOBY","ACHR","EVTL","XPeng AeroHT","Volocopter (pvt)"], ops:{hq:"Guangzhou, China",fd:2014,emp:430,ne:"Mid May 2026"}, own:{insider:33,institutional:24} },
  { t:"AMBA", themes:["drones","ai","robotics"], cc:"🇺🇸", nm:"Ambarella Inc.", v:"vision", s:"Vision SoCs", r:280, g:65, mc:2400, pe:null, pr:"CV5/CV7 SoCs · Edge AI vision · Auto + drone + robotics", d:"Pure-play edge AI vision SoC company. CV5 (5nm) + CV7 (5nm) processors deliver 12-16 TOPS for drone/robotics/auto vision. Major win designs: Skydio drones, Garmin dashcams, Bosch ADAS, automotive Tier-1s. Key beneficiary of physical AI ramp — every drone, humanoid, AMR needs vision SoC. Pivoting toward auto OEM design wins (high-volume future). Pre-profit but improving GMs.", ri:["GPU competition (NVIDIA)","Auto design win conversion","Inventory cycle"], ca:["Auto programs ramp 2026-27","Robotics/humanoid SoC demand","Drone defense market","Edge generative AI"], dc:{f:30,gr:25,w:14,tg:3,sh:42}, ms:{df:.5,re:.4,cn:.6,cf:.6}, fin:{beta:1.7,eps:-.50,div:0,rg:[12,18,25,30,28]}, rs:[["Automotive (ADAS + cameras)",46],["IoT (security + drones)",36],["Robotics + industrial",18]], geo:[["Asia (Taiwan/Japan/Korea fabless)",46],["Americas",30],["Europe",16],["Other",8]], tc:[["Auto Tier-1 (Bosch, Continental)",24],["Drone OEMs (Skydio, RCAT, etc.)",16],["Security cameras (Hikvision alt)",18],["Industrial robotics OEMs",10],["Consumer (Garmin, GoPro, etc.)",18],["Other",14]], pl:[{name:"CV7 SoC",desc:"5nm vision + 16 TOPS · ADAS L2/L3 + drone + robot · 2025 ramp",pos:"Flagship"},{name:"CV5 SoC",desc:"5nm vision · 8 TOPS · drone + 4K dashcam workhorse",pos:"Volume"},{name:"CVflow architecture",desc:"Proprietary CV inference engine · low-power physical AI",pos:"IP moat"},{name:"GenAI on edge (CV3-AD)",desc:"Generative AI inference at edge · in-cabin + autonomy",pos:"Growth vector"},{name:"Sapeon (acquired 2025)",desc:"Datacenter inference accelerators · datacenter expansion",pos:"M&A"}], cp:["NVDA Jetson","Qualcomm Ride","Mobileye","Texas Instruments","Hailo (pvt)"], ops:{hq:"Santa Clara, CA",fd:2004,emp:1000,ne:"Late Feb 2026"}, own:{insider:7,institutional:90} },
  { t:"BLDE", themes:["drones"], cc:"🇺🇸", nm:"Blade Air Mobility", v:"evtol", s:"Vertiport", r:255, g:18, mc:280, pe:null, pr:"Helicopter charters · Medical organ transport · eVTOL infrastructure", d:"Asset-light air mobility platform — operates branded helicopter routes (NYC airport transfers, Hamptons summer routes) and medical organ transport. Building the vertiport + customer network needed for eVTOL future. Pre-positioning to be operator of choice when JOBY/ACHR launch. MediMobility (medical transport) is the cash engine. Just sold European helicopter unit to refocus on US passengers + medical.", ri:["Helicopter cycle","eVTOL launch timing","MediMobility margin pressure"], ca:["JOBY/ACHR partnership announcements","Vertiport licenses","MediMobility consolidation"], dc:{f:-15,gr:12,w:13,tg:3,sh:78}, ms:{df:.1,re:.85,cn:.2,cf:.2}, fin:{beta:1.6,eps:-.20,div:0,rg:[18,22,15,12,15]}, rs:[["MediMobility (organ transport)",56],["Passenger (NYC + leisure)",36],["Other (charters)",8]], geo:[["United States",100]], tc:[["Hospital networks (organs)",54],["NYC area passengers",24],["Hamptons + East End (seasonal)",10],["Charter clients",8],["Other",4]], pl:[{name:"BLADE Airport (NYC)",desc:"On-demand JFK/EWR/LGA helicopter transfers · branded routes",pos:"Flagship passenger"},{name:"MediMobility Organ Transport",desc:"Time-critical organ delivery · #1 US provider",pos:"Cash engine"},{name:"Hamptons + Nantucket Seasonal",desc:"Summer leisure routes · pricing power",pos:"High margin"},{name:"Vertiport Network",desc:"Manhattan + Westchester locations · eVTOL-ready buildout",pos:"Strategic platform"},{name:"BLADE One Membership",desc:"Premium subscription · loyalty + repeat",pos:"LTV play"},{name:"Joby + Archer eVTOL platform partner",desc:"Partnership letters of intent · provides demand layer",pos:"Optionality"}], cp:["JOBY","ACHR","Wheels Up (UP)","NetJets (BRK pvt)","Volato"], ops:{hq:"New York, NY",fd:2014,emp:280,ne:"Mid May 2026"}, own:{insider:20,institutional:65} },
  { t:"EVTL", themes:["drones"], cc:"🇬🇧", nm:"Vertical Aerospace", v:"evtol", s:"Air Taxi", r:5, g:-200, mc:200, pe:null, pr:"VX4 eVTOL · Rolls-Royce engines · Honeywell avionics", d:"UK-based eVTOL maker. VX4 4-passenger air taxi targeting 100-mile range. Rolls-Royce powertrain partner, Honeywell flight controls. Pre-revenue, capital-constrained. Q3 2025 raised £52M. Conditional orders from American Airlines, JAL, Avolon, etc. Behind JOBY/ACHR on certification timeline.", ri:["Cash burn","Certification timeline","Capital raise dilution"], ca:["VX4 prototype testing","Series production prep","UK CAA certification"], dc:{f:-100,gr:-95,w:22,tg:3,sh:35}, ms:{df:.1,re:.85,cn:.05,cf:.1}, fin:{beta:3.0,eps:-3.50,div:0,rg:[-50,-80,-95,-99,-50]} },
  { t:"EVEX", themes:["drones"], cc:"🇧🇷", nm:"Eve Holding (Embraer)", v:"evtol", s:"Air Taxi", r:0, g:0, mc:1200, pe:null, pr:"Eve eVTOL · Embraer parentage · Air traffic management", d:"Embraer spinoff focused on eVTOL air taxi + air traffic management software. Backed by Embraer (89% ownership, after 2022 merger with Zanite). 2,800+ conditional orders. Maintenance + simulation services planned. Service entry target H2 2027. Defensive vs JOBY/ACHR via parent's manufacturing scale.", ri:["Service entry delay","Embraer parent dilution","Order conversion"], ca:["First flight 2026","FAA + ANAC certification","Service launch 2027"], dc:{f:-80,gr:0,w:18,tg:3,sh:268}, ms:{df:.1,re:.85,cn:.05,cf:.1}, fin:{beta:2.5,eps:-.30,div:0,rg:[0,0,0,0,200]} },
  { t:"DRSHF", themes:["drones","defense"], cc:"🇦🇺", nm:"DroneShield Limited", v:"counter", s:"RF", r:130, g:65, mc:1100, pe:50, pr:"DroneGun jammers · DroneSentry · RFAI · Counter-UAS", d:"Australian pure-play counter-drone leader. Modular DroneSentry detection + DroneGun handheld jammer + DroneCannon vehicle-mount. Major Five Eyes + NATO supplier. RFAI machine learning for autonomous threat ID. Massive contract growth from Ukraine + Middle East + FIFA World Cup security wins. ~3x revenue 2024-25. NDAA-compliant US assembly.", ri:["Order timing lumpiness","Customer concentration","Currency exposure"], ca:["Ukraine + Middle East orders","FIFA World Cup security","NATO program wins","Saudi giga-projects"], dc:{f:30,gr:80,w:13,tg:3,sh:840}, ms:{df:.95,re:.6,cn:.4,cf:.95}, fin:{beta:1.6,eps:.10,div:0,rg:[80,150,120,80,55]} },
  { t:"OUST", themes:["drones","robotics"], cc:"🇺🇸", nm:"Ouster Inc.", v:"vision", s:"Lidar", r:130, g:42, mc:600, pe:null, pr:"OS series digital lidar · REV7 chip · Industrial + auto + drone", d:"US lidar maker post-Velodyne merger. REV7 digital lidar SoC delivers 128/64/32 channel sensors. Industrial automation + smart infrastructure (smart city, traffic monitoring) > 50% of revenue. Drones + robotics + auto are growth verticals. Profit milestone targeted 2026. Solid-state Chronos coming.", ri:["Auto cycle","Hesai pricing pressure","Cash runway"], ca:["Chronos solid-state launch","Industrial smart city wins","Drone OEM design wins"], dc:{f:-40,gr:18,w:16,tg:3,sh:50}, ms:{df:.4,re:.6,cn:.5,cf:.4}, fin:{beta:1.8,eps:-1.20,div:0,rg:[15,25,30,25,18]} },
  { t:"INVZ", themes:["drones","robotics"], cc:"🇮🇱", nm:"Innoviz Technologies", v:"vision", s:"Lidar", r:30, g:25, mc:200, pe:null, pr:"InnovizOne · InnovizTwo · Auto + robotaxi lidar", d:"Israeli automotive lidar pure-play. InnovizTwo selected by VW Group for L3 autonomous (Audi/Porsche). BMW design win held. Robotaxi customers including Mobileye, Loop. Revenue still small but VW ramp could change trajectory. Pivoting toward defense + drone applications.", ri:["VW program timing","Cash burn","Hesai/Luminar competition"], ca:["VW Group L3 ramp","Mobileye partnership","Defense + drone wins"], dc:{f:-70,gr:120,w:20,tg:3,sh:170}, ms:{df:.3,re:.6,cn:.4,cf:.3}, fin:{beta:2.4,eps:-.80,div:0,rg:[10,40,80,120,80]} },
  { t:"LAZR", themes:["drones","robotics"], cc:"🇺🇸", nm:"Luminar Technologies", v:"vision", s:"Lidar", r:120, g:25, mc:280, pe:null, pr:"Iris+ lidar · Volvo EX90 · Halo (next-gen) · 1550nm", d:"US automotive lidar (1550nm long-range, eye-safe). Volvo EX90 launched with Iris+ as first OEM at scale. Mercedes-Benz S-Class flagship deal. Polestar PS3. February 2025: sold semiconductor unit (Luminar Semiconductor) to QUBT for $110M. Recent Q1 2026 short-seller report; under pressure. Halo next-gen targeting 2027.", ri:["Volvo ramp pace","Cash runway concern","Short-seller scrutiny"], ca:["Volvo EX90 + EX60 ramp","Mercedes S-Class launch","Halo introduction"], dc:{f:-150,gr:30,w:18,tg:3,sh:67}, ms:{df:.2,re:.55,cn:.4,cf:.2}, fin:{beta:2.5,eps:-2.20,div:0,rg:[25,40,50,30,20]} },
  { t:"HSCDY", themes:["robotics"], cc:"🇯🇵", nm:"Harmonic Drive Systems (ADR)", v:"components", s:"Actuators", r:380, g:38, mc:1700, pe:32, pr:"Strain wave gears · Precision actuators · Servo gearheads", d:"Inventor and dominant supplier of strain wave gears (sole IP control of original 'Harmonic Drive' design). Critical components in nearly every commercial humanoid robot — Tesla Optimus, Figure, Boston Dynamics Atlas, Agility Digit all use precision strain wave actuators. Also industrial robot wrist joints, semiconductor wafer handling, satellites. Boom-bust cyclicality with capex.", ri:["Capex cycle","Customer concentration","Chinese knockoffs (low-end)"], ca:["Humanoid robot supply chain","Semicap recovery","Robot density growth","Capacity expansion"], dc:{f:35,gr:8,w:11,tg:2,sh:99}, ms:{la:.7,ai:.85,mfg:.95,ra:.5}, fin:{beta:1.6,eps:.30,div:.10,rg:[15,8,-5,12,30]}, rs:[["Strain Wave Gears (Harmonic Drive)",58],["Precision Gearheads",18],["Mechatronics (drives + motors)",16],["Other",8]], geo:[["Japan",30],["China",25],["Americas",18],["Europe",17],["Other Asia",10]], tc:[["Industrial robot OEMs (FANUY, ABBNY, YASKY)",36],["Semiconductor capex",18],["Humanoid robot OEMs (TSLA, Figure, BD)",16],["Aerospace/defense",10],["Other",20]], pl:[{name:"CSF/CSG Series Strain Wave Gears",desc:"Standard precision gears · 30-160mm flexspline · 100:1 ratio",pos:"Patent franchise"},{name:"FHA Hollow Shaft Actuators",desc:"Integrated actuator + gear + encoder · humanoid joint module",pos:"Humanoid sweet spot"},{name:"AccuDrive Mini Series",desc:"Small footprint for compact robots · cobots + mobile robots",pos:"Growth"},{name:"Harmonic Mini for Humanoids",desc:"Sub-50mm strain wave · Tesla/Figure form factor",pos:"Hot product"},{name:"Customized actuator modules",desc:"Co-engineered for major robot OEMs · sole-source",pos:"Captive customers"}], cp:["Nabtesco (NCTKY)","Sumitomo Heavy","Leaderdrive (private China)","Spinea (pvt)"], ops:{hq:"Tokyo, Japan",fd:1955,emp:1200,ne:"Early Aug 2026"}, own:{insider:8,institutional:45} },
  { t:"SIEGY", themes:["robotics","ai"], cc:"🇩🇪", nm:"Siemens AG (ADR)", v:"industrial", s:"PLC", r:80000, g:38, mc:200000, pe:23, pr:"Simatic PLC · Sinumerik CNC · Mindsphere IoT · Smart Infrastructure", d:"Europe's largest industrial automation company. Digital Industries segment is heart of robotics offering — Simatic PLCs control most of Europe's factories. Sinumerik CNC for machine tools. Smart Infrastructure for buildings. Recent Industrial AI push with NVIDIA partnership for digital twins. ALTAIR acquisition (2025) deepened simulation. NVIDIA Omniverse Industrial AI deep partner.", ri:["European industrial cycle","China demand","Energy transition pacing"], ca:["NVIDIA Omniverse Industrial AI partnership","ALTAIR integration","Reindustrialization (US/EU)","Building electrification"], dc:{f:9000,gr:7,w:8,tg:2,sh:802}, ms:{la:.8,ai:.85,mfg:.95,ra:.5}, fin:{beta:1.0,eps:9.40,div:5.20,rg:[8,12,15,12,10]}, rs:[["Digital Industries (factory automation)",37],["Smart Infrastructure (buildings + grid)",26],["Mobility (rail)",16],["Healthineers (separately listed 75% stake)",13],["Other / Financial Services",8]], geo:[["EMEA",46],["Americas",30],["APAC",24]], tc:[["Industrial OEMs + machine builders",42],["Utilities + grid operators",18],["Building developers",14],["Rail operators",10],["Healthcare (via Healthineers)",8],["Other",8]], pl:[{name:"Simatic S7-1500 PLC",desc:"Industry-standard programmable logic controller · workhorse of factory floors",pos:"Category dominant"},{name:"Sinumerik CNC controls",desc:"Machine tool brain · global #1 CNC platform",pos:"Franchise"},{name:"Industrial Edge + Mindsphere",desc:"IIoT platform · edge AI · digital twin layer",pos:"Growth vector"},{name:"NVIDIA Omniverse Industrial AI",desc:"Joint platform · physical AI factory simulation",pos:"Strategic collab"},{name:"ALTAIR Engineering simulation",desc:"Acquired 2025 · CAE software · accelerates digital twin",pos:"M&A integration"},{name:"Sicarius drives + servo motors",desc:"Motion control hardware · pairs with Simatic",pos:"Captive demand"}], cp:["Schneider Electric (SBGSY)","ABBNY","Rockwell (ROK)","Honeywell","Mitsubishi Electric"], ops:{hq:"Munich, Germany",fd:1847,emp:312000,ne:"Early May 2026"}, own:{insider:.5,institutional:55} },
  { t:"GMED", themes:["robotics","biotech"], cc:"🇺🇸", nm:"Globus Medical Inc.", v:"surgical", s:"Spinal", r:2620, g:74, mc:7400, pe:28, pr:"ExcelsiusGPS · ExcelsiusFlex · Spine + ortho implants", d:"Spine + ortho implant company with ExcelsiusGPS robotic navigation. NuVasive merger 2023 ($3B all-stock) made it #2 spine. ExcelsiusFlex FDA cleared June 2024 for hip/knee. Strong organic growth from robotic ecosystem flywheel.", ri:["NuVasive integration","Hospital capex","Stryker Mako spine competition"], ca:["ExcelsiusFlex commercial ramp","NuVasive cross-sell","Spine + cranial expansion"], dc:{f:300,gr:18,w:9,tg:2,sh:138}, ms:{la:.4,ai:.5,mfg:.5,ra:.6}, fin:{beta:1.4,eps:2.20,div:0,rg:[15,18,16,14,12]} },
  { t:"PRCT", themes:["robotics","biotech"], cc:"🇺🇸", nm:"PROCEPT BioRobotics", v:"surgical", s:"Specialty", r:280, g:65, mc:5000, pe:null, pr:"AquaBeam Robotic System · Aquablation · BPH treatment", d:"Pure-play urology surgical robotics. Only FDA-cleared aquablation therapy (image-guided heat-free water jet) for BPH. Replacing TURP and UroLift. ~80% YoY revenue growth. Strong gross margin trajectory. International launches (Japan, Germany, UK) ramping.", ri:["Single-product concentration","Reimbursement","Cash burn"], ca:["International expansion","Practice + ASC growth","BPH market education"], dc:{f:-50,gr:55,w:14,tg:3,sh:55}, ms:{la:.4,ai:.5,mfg:.5,ra:.6}, fin:{beta:1.5,eps:-1.40,div:0,rg:[55,80,70,55,45]} },
  { t:"SBGSY", themes:["robotics","ai"], cc:"🇫🇷", nm:"Schneider Electric (ADR)", v:"industrial", s:"PLC", r:42000, g:42, mc:135000, pe:30, pr:"EcoStruxure · Modicon PLC · Lexium drives · APC datacenter UPS", d:"French automation giant. EcoStruxure platform for IIoT. Modicon PLCs (legacy + new). Major datacenter power player (APC). Lexium servo drives + motion control. Aveva software (acquired 2023). Strong AI datacenter tailwind via APC and electrification thesis.", ri:["Industrial cycle","China demand","Energy transition pace"], ca:["AI datacenter UPS demand","Reindustrialization","NVIDIA Omniverse partnership","Aveva digital twin"], dc:{f:6500,gr:8,w:8,tg:2,sh:560}, ms:{la:.75,ai:.85,mfg:.95,ra:.5}, fin:{beta:1.0,eps:8.40,div:4.10,rg:[10,15,18,14,12]} },
  { t:"OMRNY", themes:["robotics"], cc:"🇯🇵", nm:"OMRON Corporation (ADR)", v:"industrial", s:"PLC", r:5500, g:36, mc:8800, pe:28, pr:"Sysmac PLC · Mobile robots · Vision sensors · ATM/healthcare", d:"Japanese factory automation specialist. Sysmac integrated automation platform. Mobile robots via 2015 Adept acquisition. Strong vision sensor + safety business. Diversified into healthcare (blood pressure monitors #1 globally) and ATMs. Acquired Techman Robot's IP.", ri:["Auto/electronics cycle","JPY FX","Healthcare divestiture pressure"], ca:["Sysmac digital twin","Mobile robot growth","Cobot expansion"], dc:{f:200,gr:5,w:9,tg:2,sh:200}, ms:{la:.8,ai:.7,mfg:.9,ra:.5}, fin:{beta:1.0,eps:1.40,div:.50,rg:[3,5,7,5,4]} },
  { t:"AME", themes:["robotics","ai"], cc:"🇺🇸", nm:"AMETEK Inc.", v:"vision", s:"Sensors", r:7240, g:35, mc:42000, pe:28, pr:"Process measurement · Specialty sensors · Aerospace test", d:"Diversified electronic instruments + electromechanical company. Process & analytical instruments (Spectro, Xact). Aerospace + defense sensors (Hermetic Solutions). Specialty motion + power. M&A roll-up driving steady mid-single-digit organic growth + double-digit acquired. Strong margin expansion track record.", ri:["Industrial cycle","Aerospace cycle","M&A multiple risk"], ca:["EIG segment growth","Aerospace ramp","Bolt-on M&A"], dc:{f:1300,gr:6,w:8,tg:2,sh:230}, ms:{la:.5,ai:.65,mfg:.85,ra:.5}, fin:{beta:1.1,eps:6.55,div:1.20,rg:[6,8,10,7,5]} },
  { t:"KIOGY", themes:["robotics"], cc:"🇩🇪", nm:"KION Group (ADR)", v:"logistics", s:"Forklifts", r:13800, g:25, mc:7000, pe:18, pr:"Linde forklifts · STILL forklifts · Dematic warehouse automation", d:"World #2 forklift maker (after Toyota). Dematic = leading warehouse automation supplier (AS/RS, conveyors, AMRs, software). Major Walmart, Amazon, IKEA customer. Cyclical pressure on forklifts but Dematic growth from e-commerce supports recovery. EV/FC forklift transition.", ri:["European industrial cycle","Forklift price pressure","E-commerce normalization"], ca:["Dematic order recovery","FC/EV forklift adoption","Reshoring tailwind"], dc:{f:200,gr:6,w:11,tg:2,sh:131}, ms:{la:.85,ai:.5,mfg:.85,ra:.6}, fin:{beta:1.7,eps:3.00,div:.85,rg:[5,8,10,5,4]} },
  { t:"NOVT", themes:["robotics","ai"], cc:"🇺🇸", nm:"Novanta Inc.", v:"components", s:"Encoders", r:935, g:46, mc:5500, pe:38, pr:"Precision motion encoders · CO2 lasers · Medical imaging components", d:"Photonics + precision motion components for OEMs. Three segments: Precision Medicine (medical imaging), Robotics & Automation (motion control), and Advanced Industrial (lasers). Encoders for surgical robots, AGVs, semicap. ATEC/CAS surgical robotics customer.", ri:["OEM cycle","Medical capex","Currency exposure"], ca:["Surgical robot growth","Semi capex recovery","Industrial automation"], dc:{f:60,gr:8,w:10,tg:2,sh:36}, ms:{la:.55,ai:.7,mfg:.85,ra:.5}, fin:{beta:1.4,eps:2.50,div:0,rg:[5,8,10,8,6]} },
  { t:"MCHP", themes:["robotics","ai","drones"], cc:"🇺🇸", nm:"Microchip Technology", v:"components", s:"Drives", r:4900, g:55, mc:50000, pe:null, pr:"PIC microcontrollers · dsPIC DSCs · Motor drivers · FPGAs (Microsemi)", d:"Major analog + microcontroller supplier. Motor control + servo drives across industrial robots, drones, automotive. dsPIC DSC family ideal for 3-phase BLDC motor control common in robot joints. Recovering from 2023-25 industrial inventory destock. Aerospace/defense (Microsemi acquisition) growing well.", ri:["Industrial inventory destock pace","Auto cycle","High debt load"], ca:["Industrial recovery","Datacenter PCIe","Aerospace + defense"], dc:{f:600,gr:8,w:11,tg:2,sh:540}, ms:{la:.6,ai:.7,mfg:.9,ra:.6}, fin:{beta:1.7,eps:1.20,div:1.82,rg:[-22,-15,5,18,22]} },
  { t:"EMR", themes:["robotics"], cc:"🇺🇸", nm:"Emerson Electric", v:"industrial", s:"PLC", r:17000, g:50, mc:75000, pe:20, pr:"Process automation · Control valves · Test&measurement", d:"Process automation giant. Refining, chemicals, power plants. Newly restructured (sold off industrial automation, acquired NI). More software-oriented now.", ri:["Cyclical process industries","AspenTech integration"], ca:["Energy transition capex","AspenTech synergies"], dc:{f:2000,gr:6,w:9,tg:2,sh:570}, ms:{la:.5,ai:.4,mfg:.8,ra:.4}, fin:{beta:1.2,eps:5.20,div:2.10,rg:[2,5,8,8,8]}, rs:[["Final Control & Valves",40],["Process Systems & Solutions",30],["Measurement & Analytical",18],["Discrete Automation",12]], geo:[["Americas",52],["EMEA",28],["APAC",20]], tc:[["Oil & Gas",30],["Chemical",18],["Power",15],["Life Sciences",12],["Food/Beverage",10],["Other",15]], pl:[{name:"DeltaV DCS",desc:"Distributed Control System · process plants",pos:"#1 share"},{name:"Fisher Valves",desc:"Control valves · critical flow",pos:"Category leader"},{name:"AspenTech (majority stake)",desc:"Process simulation + MES software",pos:"Software asset"},{name:"Rosemount Measurement",desc:"Pressure/temperature/flow measurement",pos:"Franchise"},{name:"Branson (ultrasonics)",desc:"Ultrasonic welding + cleaning",pos:"Discrete auto"}], cp:["SIEGY","SCHN","ABBNY","ROK","HON"], ops:{hq:"St Louis, MO",fd:1890,emp:67000,ne:"May 2026"}, own:{insider:.2,institutional:82} },
  { t:"FANUY", themes:["robotics"], cc:"🇯🇵", nm:"FANUC Corp (ADR)", v:"industrial", s:"Arms", r:6000, g:40, mc:25000, pe:30, pr:"Industrial robot arms · CNCs · Robomachines", d:"World's largest industrial robot manufacturer. Factory automation arm leader. Exposure to China capex and semiconductor equipment.", ri:["China semi capex cycle","FX exposure"], ca:["Auto + semi capex cycle","Humanoid-to-industrial crossover"], dc:{f:800,gr:5,w:8,tg:2,sh:970}, ms:{la:.8,ai:.5,mfg:.95,ra:.3,cn:.7}, fin:{beta:0.9,eps:.80,div:.50,rg:[0,4,6,7,7]}, rs:[["Factory Automation (CNC)",48],["ROBOT (industrial arms)",32],["ROBOMACHINE",14],["Service",6]], geo:[["APAC (ex Japan)",33],["Japan",28],["Americas",22],["Europe",17]], tc:[["Automotive",22],["General industrial",25],["EMS (electronics mfg services)",18],["Machine tool builders",20],["Semi equipment",15]], pl:[{name:"CRX Collaborative Robots",desc:"Next-gen cobots · 5-25kg payloads",pos:"Growing"},{name:"R-2000iC / M-410 series",desc:"Heavy-payload industrial robots",pos:"Category leader"},{name:"CNC Controls",desc:"Factory automation · Series 30i/31i/32i",pos:"Franchise"},{name:"ROBODRILL",desc:"Compact machining centers for smartphones",pos:"Apple-tied demand"},{name:"FIELD system",desc:"IoT platform for manufacturing",pos:"Digital layer"}], cp:["ABBNY","YASKY","KUKA","EPSTY","SIEGY"], ops:{hq:"Oshino, Japan",fd:1972,emp:9100,ne:"May 2026"}, own:{insider:5,institutional:55} },
  { t:"ABBNY", themes:["robotics"], cc:"🇨🇭", nm:"ABB Ltd (ADR)", v:"industrial", s:"Arms", r:32000, g:37, mc:90000, pe:22, pr:"Robotics · Electrification · Motion · Process automation", d:"Swiss industrial giant. Robotics segment ranks #2 globally (behind FANUC). Also electrification leader — beneficiary of DC buildout.", ri:["Cyclical exposure","FX"], ca:["AI DC electrification","Industrial automation recovery"], dc:{f:3500,gr:5,w:9,tg:2,sh:1850}, ms:{la:.7,ai:.5,mfg:.85,ra:.4,cn:.5}, fin:{beta:1.0,eps:2.20,div:.95,rg:[2,5,7,7,7]}, rs:[["Electrification",43],["Motion (motors/drives)",30],["Process Automation",20],["Robotics & Discrete",7]], geo:[["Europe",32],["Americas",28],["Asia (inc. China)",28],["ME/Africa",12]], tc:[["Utilities (grid/DC)",30],["Industrials",28],["Buildings",20],["Transportation",12],["Other",10]], pl:[{name:"Electrification division",desc:"LV/MV switchgear · EV chargers · grid products",pos:"AI DC tailwind"},{name:"YuMi / FlexPicker",desc:"Collaborative robots · picking automation",pos:"Key robotics brand"},{name:"ACS drives",desc:"Industrial motor controls",pos:"Market leader"},{name:"Ability platform",desc:"Industrial IoT software layer",pos:"Digital layer"},{name:"Terra DC fast chargers",desc:"EV charging hardware globally",pos:"Franchise"}], cp:["SIEGY","ROK","EMR","FANUY","YASKY"], ops:{hq:"Zurich, Switzerland",fd:1883,emp:110000,ne:"Apr 2026"}, own:{insider:20,institutional:60} },
  { t:"ISRG", themes:["robotics"], cc:"🇺🇸", nm:"Intuitive Surgical", v:"surgical", s:"Soft Tissue", r:8300, g:68, mc:200000, pe:75, pr:"da Vinci surgical robots · Ion endoluminal", d:"Dominant surgical robot maker (da Vinci). ~80% share. Recurring razor+blade model with instruments. Ion lung biopsy ramp.", ri:["Premium valuation","Payer pushback"], ca:["da Vinci 5 launch","Ion international rollout"], dc:{f:1800,gr:14,w:9,tg:3,sh:360}, ms:{la:.6,ai:.7,mfg:.2,ra:.3}, fin:{beta:1.2,eps:5.80,div:0,rg:[14,18,22,22,20]}, rs:[["Instruments & Accessories",60],["Systems (da Vinci/Ion)",20],["Services",20]], geo:[["US",70],["Europe",15],["Asia",10],["ROW",5]], tc:[["Hospital networks (HCA, Tenet, etc.)",45],["Academic medical centers",25],["International hospitals",20],["Outpatient/ASC",10]], pl:[{name:"da Vinci 5",desc:"Latest-gen surgical robot · force feedback · AI features · launched 2024",pos:"#1 soft-tissue surgical robot"},{name:"da Vinci X/Xi",desc:"Installed base · 9,000+ units globally",pos:"Razor-razorblade"},{name:"Ion Endoluminal",desc:"Robotic lung biopsy platform",pos:"Fastest-growing segment"},{name:"SP (Single Port)",desc:"Single-incision platform · urology expanded",pos:"Expansion"},{name:"My Intuitive",desc:"Digital surgeon tools · case data / learning",pos:"Software layer"}], cp:["MDT (Hugo)","SYK (Mako orthopedic)","JNJ (Ottava)","CMR Surgical (private)"], ops:{hq:"Sunnyvale, CA",fd:1995,emp:14000,ne:"Apr 2026"}, own:{insider:.1,institutional:86} },
  { t:"ZBRA", themes:["robotics"], cc:"🇺🇸", nm:"Zebra Technologies", v:"logistics", s:"Picking", r:4700, g:47, mc:17000, pe:28, pr:"Barcode · RFID · Fetch AMRs", d:"Enterprise asset visibility. Barcode scanners, RFID, mobile computing, plus Fetch Robotics AMRs. Warehouse automation exposure.", ri:["Channel destocking","Cyclical retail capex"], ca:["AMR ramp","Retail recapitalization"], dc:{f:500,gr:6,w:10,tg:2,sh:52}, ms:{la:.75,ai:.5,mfg:.7,ra:.4}, fin:{beta:1.3,eps:4.80,div:0,rg:[0,3,5,7,8]}, rs:[["Enterprise Visibility & Mobility",65],["Asset Intelligence & Tracking",35]], geo:[["North America",56],["EMEA",29],["APAC",11],["LatAm",4]], tc:[["Retail & e-commerce",35],["Transportation & Logistics",28],["Manufacturing",18],["Healthcare",12],["Other",7]], pl:[{name:"Mobile Computers",desc:"Rugged Android handhelds · TC series",pos:"#1 in enterprise"},{name:"Barcode Scanners",desc:"Fixed + handheld scanners",pos:"Franchise"},{name:"Zebra Workcloud",desc:"SaaS for frontline workers",pos:"Growing ARR"},{name:"Fetch Robotics (AMR)",desc:"Autonomous mobile robots · acquired 2021",pos:"Strategic pivot"},{name:"Matrox Imaging",desc:"Machine vision acq · quality inspection",pos:"Newer segment"}], cp:["Honeywell","Datalogic","6 River Systems","Locus (pvt)"], ops:{hq:"Lincolnshire, IL",fd:1969,emp:9700,ne:"May 2026"}, own:{insider:1,institutional:92} },
  { t:"TER", themes:["robotics"], cc:"🇺🇸", nm:"Teradyne Inc", v:"software", s:"Vision", r:2800, g:57, mc:20000, pe:35, pr:"Test equipment · Universal Robots · MiR AMRs", d:"Semiconductor test equipment leader. Also Universal Robots (collaborative robots / cobots) + MiR (AMRs). Robotics is still small but strategic.", ri:["Semi test cyclical","Robotics scale"], ca:["AI test content growth","UR20 cobot cycle"], dc:{f:600,gr:10,w:10,tg:2,sh:160}, ms:{la:.5,ai:.7,mfg:.7,ra:.3}, fin:{beta:1.4,eps:3.10,div:.48,rg:[0,5,10,12,12]}, rs:[["Semiconductor Test",68],["System-Level Test & Storage",12],["Robotics (Universal Robots + MiR)",15],["Other",5]], geo:[["Taiwan",24],["Korea",22],["US",16],["China",14],["Japan",12],["Other",12]], tc:[["TSMC",20],["Samsung",15],["Intel",10],["Hon Hai/FII",10],["Micron",6],["Others",39]], pl:[{name:"J750 / UltraFlex",desc:"SoC test platforms · leading-edge nodes",pos:"Category leader"},{name:"Magnum Memory Test",desc:"DRAM/HBM memory test · AI-memory tailwind",pos:"HBM beneficiary"},{name:"Universal Robots",desc:"#1 cobot maker · UR20 added · food/mfg pivot",pos:"Cobot leader"},{name:"MiR AMRs",desc:"Autonomous mobile robots · warehouse/mfg",pos:"Growth"},{name:"LitePoint",desc:"Wireless test",pos:"Niche"}], cp:["KEYS","ADTN","AMAT","AEIS","ABBNY","FANUY"], ops:{hq:"North Reading, MA",fd:1960,emp:6400,ne:"Apr 2026"}, own:{insider:.2,institutional:90} },

  /* ═══════════════ QUANTUM · PURE-PLAYS ═══════════════ */
  { t:"IONQ", themes:["quantum"], cc:"🇺🇸", nm:"IonQ Inc", v:"hardware", s:"Trapped Ion", r:40, g:null, mc:7500, pe:null, pr:"Trapped-ion quantum computers · Forte Enterprise", d:"Leading trapped-ion quantum pure-play. Partners with Microsoft, Amazon, Google clouds. Recent Oxford Ionics acquisition for chip-scale ion trapping.", ri:["Pre-revenue scale","Error correction moving target"], ca:["Oxford Ionics integration","DoD Q-NEXT wins","Networking quantum systems"], dc:{f:-70,gr:150,w:18,tg:3,sh:220}, ms:{rd:.95,eg:.85,cl:.9,ra:.6}, fin:{beta:3.0,eps:-.80,div:0,rg:[20,80,150,200,200]}, rs:[["Systems & Cloud Access",75],["Quantum Networking",15],["Services/Contracts",10]], geo:[["US",80],["Europe",12],["APAC",8]], tc:[["US Federal (DoD/DoE/NIH)",55],["AWS/Azure/Google Cloud",28],["Commercial enterprise",12],["Other",5]], pl:[{name:"Forte Enterprise",desc:"36-algorithmic qubit trapped-ion system",pos:"Commercial flagship"},{name:"Tempo",desc:"64-qubit next-gen system · DataCenter form factor",pos:"Roadmap"},{name:"Oxford Ionics chip-scale",desc:"Acquisition · chip-integrated ion traps",pos:"Scaling path"},{name:"Quantum Networking",desc:"Photonic interconnect · ion-photon entanglement",pos:"Differentiator"},{name:"CUDA-Q integration",desc:"NVIDIA partnership · hybrid classical-quantum",pos:"Ecosystem"}], cp:["RGTI","QBTS","QUBT","IBM","HON","INFQ","PsiQuantum (pvt)","Quantinuum (pvt)"], ops:{hq:"College Park, MD",fd:2015,emp:500,bl:{label:"Gov contracts",val:100,unit:"M"},ne:"May 2026"}, own:{insider:6,institutional:45} },
  { t:"RGTI", themes:["quantum"], cc:"🇺🇸", nm:"Rigetti Computing", v:"hardware", s:"Superconducting", r:10, g:null, mc:3500, pe:null, pr:"Superconducting quantum · Ankaa-3 system", d:"Superconducting quantum pure-play. Currently behind IBM/Google on qubit count. Full-stack approach. Meme-stock energy.", ri:["Burn rate","Behind on scaling"], ca:["Ankaa-3 deployment","DARPA programs"], dc:{f:-50,gr:200,w:20,tg:3,sh:310}, ms:{rd:.95,eg:.9,cl:.8,ra:.7}, fin:{beta:3.2,eps:-.30,div:0,rg:[10,50,100,200,300]}, rs:[["Systems revenue",30],["Cloud & Services",40],["Government contracts",30]], geo:[["US",85],["UK/Europe",12],["APAC",3]], tc:[["US Govt (DARPA, DoE, Airforce)",55],["AWS/AFRL",25],["Commercial",10],["Other",10]], pl:[{name:"Ankaa-3 (84-qubit)",desc:"Superconducting system · multi-chip",pos:"Current flagship"},{name:"Novera",desc:"QPU platform for on-prem · lab units",pos:"On-prem option"},{name:"4-chip 336-qubit system",desc:"2026 roadmap milestone",pos:"Key deliverable"},{name:"DARPA contracts",desc:"QBI Stage A/B · US govt anchor",pos:"Funding"}], cp:["IONQ","QBTS","QUBT","INFQ","IBM","HON"], ops:{hq:"Berkeley, CA",fd:2013,emp:140,ne:"May 2026"}, own:{insider:8,institutional:22} },
  { t:"QBTS", themes:["quantum"], cc:"🇨🇦", nm:"D-Wave Quantum", v:"hardware", s:"Neutral Atom", r:9, g:null, mc:2000, pe:null, pr:"Annealing quantum · Advantage2 system", d:"Quantum annealing specialist (different paradigm than gate-based). Advantage2 system in production. Optimization-focused use cases.", ri:["Non-gate architecture limits","Revenue base tiny"], ca:["Commercial optimization wins","Hybrid solver adoption"], dc:{f:-30,gr:150,w:20,tg:3,sh:300}, ms:{rd:.9,eg:.5,cl:.7,ra:.7}, fin:{beta:3.0,eps:-.25,div:0,rg:[10,40,100,150,200]}, rs:[["Systems sales",40],["Quantum cloud/QaaS",45],["Services",15]], geo:[["US",60],["Japan",15],["Europe",20],["ROW",5]], tc:[["USC/Forschungszentrum Julich",20],["Los Alamos",15],["Commercial enterprise",40],["Financial/logistics",25]], pl:[{name:"Advantage2",desc:"4,400-qubit annealer · installed systems",pos:"Annealing leader"},{name:"Leap Cloud",desc:"Quantum cloud platform · hybrid solver",pos:"SaaS layer"},{name:"Zephyr architecture",desc:"Next-gen topology · 7000-qubit roadmap",pos:"Future"},{name:"Ocean SDK",desc:"Python optimization tools · developer mindshare",pos:"Adoption"}], cp:["IONQ","RGTI","QUBT","IBM"], ops:{hq:"Burnaby, BC, Canada",fd:1999,emp:200,ne:"May 2026"}, own:{insider:3,institutional:35} },
  { t:"QUBT", themes:["quantum"], cc:"🇺🇸", nm:"Quantum Computing Inc", v:"hardware", s:"Photonic", r:2, g:null, mc:2000, pe:null, pr:"Photonic quantum · Reservoir computing", d:"Photonic-based quantum computing + reservoir computing. Very small revenue. Retail meme-stock energy. Tempe, AZ foundry building.", ri:["Micro-revenue","Dilution"], ca:["AZ foundry","Retail momentum"], dc:{f:-20,gr:300,w:25,tg:3,sh:140}, ms:{rd:.9,eg:.6,cl:.7,ra:.7}, fin:{beta:4.0,eps:-.15,div:0,rg:[0,100,300,500,400]}, rs:[["Thin-film lithium niobate chips (TFLN)",50],["Photonic systems",35],["Reservoir computing",15]], geo:[["US",95],["International R&D",5]], tc:[["US DoD / federal",60],["Commercial R&D partners",25],["Academic",15]], pl:[{name:"Tempe AZ TFLN foundry",desc:"Thin-film lithium niobate chip fab · under construction",pos:"Strategic asset"},{name:"Dirac photonic computers",desc:"Optimization-focused photonic system",pos:"Alternate arch"},{name:"Reservoir Computing",desc:"Non-gate photonic compute",pos:"Niche"},{name:"EmuCore (emulation)",desc:"Quantum-inspired classical compute",pos:"Low-revenue"}], cp:["IONQ","RGTI","QBTS","Lightmatter (pvt)","PsiQuantum (pvt)"], ops:{hq:"Hoboken, NJ",fd:2018,emp:60,ne:"May 2026"}, own:{insider:3,institutional:8} },
  { t:"IBM", themes:["quantum"], cc:"🇺🇸", nm:"IBM Corporation", v:"hardware", s:"Superconducting", r:62000, g:56, mc:210000, pe:25, pr:"Quantum + enterprise IT · Consulting · Software", d:"Longest-running quantum program in corporate America. Condor 1,121-qubit + IBM Quantum Heron. Full classical IT biz funds the quantum program.", ri:["Quantum timeline vs hype","Services commoditization"], ca:["Quantum networks","Watson AI"], dc:{f:10000,gr:3,w:8,tg:2,sh:930}, ms:{rd:.7,eg:.7,cl:.9,ra:.4}, fin:{beta:0.7,eps:7.20,div:6.68,rg:[0,3,5,5,5]}, rs:[["Software",42],["Consulting",34],["Infrastructure",23],["Financing",1]], geo:[["Americas",50],["EMEA",30],["APAC",20]], tc:[["Fortune 500 enterprise",55],["Governments",20],["SMB",15],["Hyperscalers/partners",10]], pl:[{name:"watsonx AI platform",desc:"Enterprise GenAI · Granite models · Agent orchestration",pos:"Enterprise AI bet"},{name:"Red Hat OpenShift",desc:"Container platform · $34B 2019 acquisition foundation",pos:"Hybrid cloud core"},{name:"IBM Quantum",desc:"Condor 1,121 qubit + Heron · 433 qubit on-cloud",pos:"Fleet leader"},{name:"zSystems mainframe",desc:"z17 · financial services / mission critical",pos:"Secular moat"},{name:"Apptio / HashiCorp",desc:"2023/2025 acquisitions · FinOps + IaC",pos:"Software roll-up"},{name:"Consulting",desc:"Hybrid cloud transformation services",pos:"#2 IT consulting"}], cp:["MSFT","AMZN","GOOG","ORCL","CRM","NOW","ACN"], ops:{hq:"Armonk, NY",fd:1911,emp:288000,ne:"Apr 2026"}, own:{insider:.1,institutional:61} },
  { t:"HON", themes:["quantum"], cc:"🇺🇸", nm:"Honeywell (Quantinuum)", v:"hardware", s:"Trapped Ion", r:37000, g:40, mc:145000, pe:22, pr:"Quantinuum trapped-ion · Industrial automation", d:"Majority owns Quantinuum (formerly Honeywell Quantum Solutions + Cambridge Quantum). Strongest commercial quantum roadmap among hardware players. Plus industrial diversification.", ri:["Quantinuum dilution timing","Aerospace cycle"], ca:["Quantinuum IPO track","Industrial automation"], dc:{f:5500,gr:4,w:8,tg:2,sh:650}, ms:{rd:.6,eg:.8,cl:.85,ra:.4}, fin:{beta:1.0,eps:9.80,div:4.36,rg:[3,4,5,5,6]}, rs:[["Aerospace",40],["Performance Materials & Tech",25],["Industrial Automation",20],["Energy & Sustainability Solutions",15]], geo:[["US",58],["EMEA",22],["APAC",15],["LatAm",5]], tc:[["DoD/aerospace primes",28],["Commercial airlines",22],["Industrial processes",20],["Energy/utilities",15],["Other",15]], pl:[{name:"Quantinuum (majority owner)",desc:"H-series trapped-ion · merged with CQC · IPO prep",pos:"Quantum crown jewel"},{name:"UOP (Process Tech)",desc:"Process licensing + catalysts · refining",pos:"Franchise"},{name:"Honeywell Building Tech",desc:"HVAC + security · increasingly connected",pos:"Cyclical"},{name:"Experion DCS",desc:"Process control systems",pos:"Incumbent"},{name:"Sustainable Technology Solutions",desc:"SAF + energy transition",pos:"Growth"}], cp:["EMR","SIEGY","JCI","ROK","GE Aerospace","RTX"], ops:{hq:"Charlotte, NC",fd:1906,emp:95000,ne:"Apr 2026"}, own:{insider:.1,institutional:79} },

  /* ═══════════════ BIOTECH · GLP-1 & OBESITY ═══════════════ */
  { t:"LLY", themes:["biotech"], cc:"🇺🇸", nm:"Eli Lilly", v:"incumbents", s:"GLP-1/GIP", r:65179, g:82, mc:770000, pe:58, pr:"Mounjaro · Zepbound (tirzepatide) · Orforglipron (oral)", d:"Dominant US GLP-1/GIP player. FY25 revenue $65.2B (+45% YoY). Tirzepatide (Mounjaro+Zepbound) became the world's best-selling drug in Q3 2025 at $10.1B quarterly. Orforglipron oral GLP-1 filed 2025.", ri:["CMS price negotiation","Pharma tariffs","Compounder competition"], ca:["Orforglipron approval","Retatrutide Phase 3","Medicare coverage"], dc:{f:12000,gr:45,w:8,tg:3,sh:950}, ms:{mr:.9,ip:.8,ad:.95,ra:.4}, fin:{beta:.5,eps:22.00,div:6.00,rg:[20,35,45,45,30]}, rs:[["Mounjaro (T2D)",37],["Zepbound (Obesity)",20],["Verzenio (Oncology)",6],["Jardiance",7],["Trulicity",4],["Humulin/Humalog",3],["Immunology",6],["Neuroscience",5],["Other",12]], geo:[["US",70],["Europe",13],["Japan",6],["China",4],["ROW",7]], tc:[["Cencora/AmerisourceBergen",32],["Cardinal Health",24],["McKesson",21],["Other distributors/direct",23]], pl:[{name:"Mounjaro (Tirzepatide, T2D)",desc:"Q4'25 $7.4B (+110% YoY) · FY25 ~$24B · world's #1 drug",pos:"Franchise"},{name:"Zepbound (Tirzepatide, Obesity)",desc:"Q3'25 $3.6B US (+185% YoY) · FY25 ~$13B",pos:"#1 obesity"},{name:"Orforglipron",desc:"Oral GLP-1 · 7 Phase 3 trials · FDA filing 2025",pos:"First oral small-mol GLP-1"},{name:"Retatrutide",desc:"Triple agonist (GLP-1/GIP/glucagon) · Phase 3",pos:"Pipeline lead"},{name:"Kisunla (Donanemab)",desc:"Alzheimer's · launched",pos:"Launched"},{name:"Verzenio",desc:"Abemaciclib · breast cancer · FY25 ~$5.5B",pos:"Franchise"},{name:"Jaypirca · Ebglyss · Omvoh",desc:"Recent launches · oncology + immunology",pos:"Growth"}], cp:["NVO","AMGN","PFE","RHHBY","AZN"], ops:{hq:"Indianapolis, IN",fd:1876,emp:46000,mfg:["Indianapolis IN","Lebanon IN (new)","Concord NC (new)","Research Triangle NC","Kinsale Ireland"],ne:"Late Apr 2026"}, own:{insider:.1,institutional:82} },
  { t:"NVO", themes:["biotech"], cc:"🇩🇰", nm:"Novo Nordisk", v:"incumbents", s:"GLP-1/GIP", r:46800, g:81, mc:320000, pe:18, pr:"Ozempic · Wegovy · CagriSema · oral amycretin", d:"Originator of GLP-1 franchise. FY25 revenue $46.8B (+10% CER). Semaglutide hit $34.6B (74% of revenue). US GLP-1 prescription share dropped to 42% vs LLY 58%. Cut guidance 3x in 2025; Wegovy $199 self-pay launched Nov 2025.", ri:["LLY share loss (58% vs 42%)","IRA Medicare MFP 2027","Capacity vs demand","2026 semaglutide patent cliff intl"], ca:["Akero MASH acquisition","Amycretin oral Phase 3","CagriSema re-read"], dc:{f:16000,gr:10,w:8,tg:3,sh:4500}, ms:{mr:.9,ip:.8,ad:.95,ra:.4}, fin:{beta:.4,eps:4.00,div:1.60,rg:[15,25,30,15,10]}, rs:[["Ozempic (T2D)",41],["Wegovy (Obesity)",30],["Rybelsus (Oral GLP-1)",7],["Insulin",15],["Victoza (declining)",1],["Rare Disease",6]], geo:[["North America",56],["Europe (EUCAN)",19],["International Ops (Int'l+APAC)",15],["China",6],["Emerging",4]], tc:[["Major US PBMs",40],["Cencora/Cardinal/McKesson",30],["Direct to Pharma (INT)",20],["Rare disease specialty",10]], pl:[{name:"Ozempic (Semaglutide T2D)",desc:"FY25 DKK 127B (~$19.3B · +13% CER) · slowing in US",pos:"#2 GLP-1"},{name:"Wegovy (Semaglutide Obesity)",desc:"Q3'25 DKK 20B (+168% YoY) · $199/mo self-pay · cash channel 30% of scripts",pos:"#2 obesity"},{name:"Rybelsus (Oral Sema)",desc:"Only oral GLP-1 currently · FY25 ~$3.4B · 40+ countries",pos:"Franchise"},{name:"CagriSema",desc:"Cagrilintide + Semaglutide · Phase 3 disappointed",pos:"Pipeline (reset)"},{name:"Amycretin",desc:"Dual amylin/GLP-1 · subQ + oral · Phase 2",pos:"Next-gen bet"},{name:"Akero (FGF21 MASH)",desc:"Pending acquisition announcement · 2026 close",pos:"MASH expansion"},{name:"Restructuring (9,000 cuts)",desc:"DKK 8B annual savings by end-2026",pos:"Cost reset"}], cp:["LLY","AMGN","PFE","RHHBY","ZEAL","VKTX"], ops:{hq:"Bagsværd, Denmark",fd:1923,emp:72000,ne:"Early Feb 2026"}, own:{insider:28,institutional:35} },
  { t:"AMGN", themes:["biotech"], cc:"🇺🇸", nm:"Amgen", v:"incumbents", s:"Injectable", r:35000, g:74, mc:155000, pe:20, pr:"MariTide monthly obesity · biosimilars · oncology", d:"MariTide Phase 2 — monthly subcutaneous GLP-1/GIP antagonist with potential durability advantage. Phase 3 reading 2026. Biosimilars buffer.", ri:["MariTide Phase 3 risk","Competitive category"], ca:["MariTide Phase 3","Biosimilars growth"], dc:{f:8500,gr:5,w:8,tg:2,sh:540}, ms:{mr:.85,ip:.7,ad:.8,ra:.4}, fin:{beta:.7,eps:12.00,div:9.52,rg:[3,8,10,8,8]}, rs:[["Prolia",17],["Repatha",10],["Enbrel",9],["Evenity",7],["Tepezza",8],["Otezla",7],["Blincyto",6],["Xgeva",6],["Biosimilars",12],["Other",18]], geo:[["US",75],["Europe",15],["ROW",10]], tc:[["Major US PBMs",38],["Cardinal/Cencora/McKesson",30],["International payers",22],["Specialty pharmacy",10]], pl:[{name:"MariTide",desc:"Maridebart cafraglutide · Monthly GLP-1/GIP antagonist · Phase 3",pos:"Monthly cadence differentiator"},{name:"Repatha",desc:"PCSK9 inhibitor · cholesterol",pos:"Category share growing"},{name:"Prolia/Xgeva",desc:"Denosumab · bone",pos:"Biosimilar 2026"},{name:"Tepezza",desc:"Teprotumumab · thyroid eye disease",pos:"From Horizon acq"},{name:"Blincyto",desc:"Blinatumomab · leukemia",pos:"Growth"},{name:"Biosimilars",desc:"Multiple products inc. Amgevita, Riabni",pos:"Growing"}], cp:["LLY","NVO","REGN","BIIB","ABBV","JNJ"], ops:{hq:"Thousand Oaks, CA",fd:1980,emp:28000,ne:"Late Apr 2026"}, own:{insider:.1,institutional:78} },
  { t:"VKTX", themes:["biotech"], cc:"🇺🇸", nm:"Viking Therapeutics", v:"next_gen", s:"Multi-agonist", r:0, g:null, mc:4500, pe:null, pr:"VK2735 (subQ + oral) · Muscle-sparing obesity", d:"Leading next-gen obesity biotech. VK2735 subQ Phase 3, oral Phase 2. Strong early data. M&A speculation perennial.", ri:["Pre-revenue","Dilution until approval"], ca:["VK2735 Phase 3 readout","Strategic acquisition interest"], dc:{f:-150,gr:null,w:15,tg:3,sh:110}, ms:{mr:.4,ip:.4,ad:.9,ra:.6}, fin:{beta:2.5,eps:-2.00,div:0,rg:[0,0,0,100,500]}, rs:[["Pre-revenue",100]], geo:[["US (R&D only)",100]], pl:[{name:"VK2735 (subQ)",desc:"Dual GLP-1/GIP · Phase 3 in obesity",pos:"Lead asset"},{name:"VK2735 (oral)",desc:"Oral small-mol dual GLP-1/GIP · Phase 2",pos:"Differentiation"},{name:"VK2809",desc:"Thyroid-β agonist · Phase 3 MASH",pos:"Non-obesity asset"},{name:"VK0214",desc:"X-ALD · Phase 1",pos:"Early"}], cp:["LLY","NVO","AMGN","ZEAL","ALT","TERN","GPCR"], ops:{hq:"San Diego, CA",fd:2013,emp:80}, own:{insider:3,institutional:85} },
  { t:"ALT", themes:["biotech"], cc:"🇺🇸", nm:"Altimmune", v:"next_gen", s:"Multi-agonist", r:0, g:null, mc:350, pe:null, pr:"Pemvidutide (GLP-1/glucagon) · MASH + obesity", d:"GLP-1 + glucagon dual agonist targeting obesity + MASH. Phase 2 readouts in MASH — differentiated on liver fat reduction.", ri:["Micro-cap volatility","Crowded category"], ca:["Phase 2 MASH data","Obesity Phase 3 start"], dc:{f:-80,gr:null,w:18,tg:3,sh:75}, ms:{mr:.3,ip:.3,ad:.7,ra:.7}, fin:{beta:2.8,eps:-1.50,div:0,rg:[0,0,0,50,200]}, rs:[["Pre-revenue (pipeline + partnerships)",100]], geo:[["US (R&D only)",100]], tc:[["NA (pre-commercial)",100]], pl:[{name:"Pemvidutide",desc:"GLP-1/Glucagon dual · Phase 2b MASH + obesity",pos:"Lead asset"},{name:"HepTcell",desc:"Hepatitis B vaccine · Phase 2",pos:"Non-obesity"},{name:"NasoVAX",desc:"Intranasal flu vaccine · paused",pos:"Deprioritized"}], cp:["VKTX","TERN","NVO","LLY","ZEAL"], ops:{hq:"Gaithersburg, MD",fd:1997,emp:90,ne:"May 2026"}, own:{insider:2,institutional:80} },
  { t:"TERN", themes:["biotech"], cc:"🇺🇸", nm:"Terns Pharmaceuticals", v:"next_gen", s:"Oral", r:0, g:null, mc:800, pe:null, pr:"TERN-601 (oral GLP-1) · CML", d:"Oral GLP-1 small-molecule developer. Phase 1 data promising. Also has CML asset. Early-stage obesity story.", ri:["Pre-revenue","Phase 1 timing"], ca:["Phase 2 initiation","Competitive differentiation"], dc:{f:-60,gr:null,w:18,tg:3,sh:90}, ms:{mr:.3,ip:.3,ad:.6,ra:.6}, fin:{beta:2.6,eps:-1.00,div:0,rg:[0,0,0,50,200]} },
  { t:"CTLT", themes:["biotech"], cc:"🇺🇸", nm:"Catalent Inc", v:"cdmo", s:"Fill-finish", r:4500, g:22, mc:10000, pe:null, pr:"CDMO · pre-filled pens · sterile fill-finish", d:"Major biopharma CDMO. NVO uses Catalent for Wegovy fill-finish. Ozempic/Wegovy capacity bottleneck = Catalent revenue. Novo-Holdings-owned.", ri:["Integration under Novo Holdings","Single-customer exposure"], ca:["GLP-1 volume demand","Fill-finish capacity"], dc:{f:200,gr:10,w:10,tg:2,sh:180}, ms:{mr:.5,ip:.4,ad:.85,ra:.4}, fin:{beta:1.3,eps:-.30,div:0,rg:[-5,5,10,15,15]}, rs:[["Biologics CDMO",52],["Pharma & Consumer Health",28],["Oral & Specialty Delivery",12],["Clinical Supply",8]], geo:[["US",60],["Europe",30],["ROW",10]], tc:[["Novo Nordisk (Wegovy fill-finish)",23],["Eli Lilly",11],["Moderna",9],["Multiple biopharma",57]], pl:[{name:"Pre-filled syringes",desc:"Sterile fill-finish for injectables · GLP-1 bottleneck",pos:"Capacity-constrained"},{name:"Biologics CDMO",desc:"Monoclonal antibody mfg · Bloomington, IN site",pos:"Expanding"},{name:"Gene therapy mfg",desc:"Baltimore viral vector",pos:"Slow recovery"},{name:"Softgel capsules",desc:"Oral solid dose · consumer & Rx",pos:"Franchise"}], cp:["LNZA","RGEN","WST","BDX"], ops:{hq:"Somerset, NJ",fd:2007,emp:17000,ne:"Under Novo Holdings (private proxy)"}, own:{insider:0,institutional:100} },
  { t:"LNZA", themes:["biotech"], cc:"🇨🇭", nm:"Lonza Group (ADR)", v:"cdmo", s:"API", r:7500, g:30, mc:45000, pe:30, pr:"CDMO · biologics · mammalian cell culture", d:"World's largest pure-play biologics CDMO. Strong in mammalian cell culture for antibodies. Expanding GLP-1 and ADC capacity. Moderna mRNA partnership.", ri:["Lumpy project revenue","Capex intensity"], ca:["GLP-1 expansion","ADC capacity"], dc:{f:900,gr:6,w:9,tg:2,sh:72}, ms:{mr:.4,ip:.4,ad:.8,ra:.4}, fin:{beta:0.9,eps:3.50,div:1.85,rg:[2,5,7,8,9]}, rs:[["Biologics (mAb + gene therapy mfg)",42],["Small molecules",28],["Capsules & Health Ingredients",20],["Cell & Gene Therapy",10]], geo:[["Switzerland + Europe (sites)",50],["US (sites)",38],["China + Asia",12]], tc:[["Novo Nordisk (Wegovy fill-finish)",15],["Top-20 biopharma",42],["Mid-sized biotech",28],["Other",15]], pl:[{name:"Mammalian (Visp + Portsmouth)",desc:"mAb + Ig + recombinant proteins · largest globally",pos:"#1 CDMO"},{name:"Microbial (Kouřim CZ)",desc:"E. coli + yeast expression · growth",pos:"Franchise"},{name:"Cell & Gene Therapy (Houston + Pearland)",desc:"Viral vector + autologous cell therapy mfg",pos:"Strategic growth"},{name:"Capsules (Vcaps)",desc:"Pharma capsule shells · global leader",pos:"Consumer/Pharma"},{name:"Genentech Vacaville (acq 2024)",desc:"$1.2B Roche site acq · expanded US biologics capacity",pos:"Strategic expansion"}], cp:["CTLT","Samsung Biologics","WuXi Bio","Boehringer Ingelheim BioPharma"], ops:{hq:"Basel, Switzerland",fd:1897,emp:19000,ne:"Late Jul 2026"}, own:{insider:.2,institutional:70} },
  { t:"RGEN", themes:["biotech"], cc:"🇺🇸", nm:"Repligen", v:"cdmo", s:"Bioreactor", r:670, g:50, mc:9000, pe:80, pr:"Bioprocessing equipment · Filters · Chromatography", d:"Bioprocessing consumables/equipment. Protein A resin, single-use bioreactors, filtration. GLP-1 volume pull-through on biologics equipment.", ri:["Bioprocessing destocking","Premium valuation"], ca:["GLP-1 bioprocessing orders","Destocking cycle end"], dc:{f:120,gr:10,w:11,tg:2,sh:56}, ms:{mr:.4,ip:.4,ad:.8,ra:.4}, fin:{beta:1.4,eps:1.60,div:0,rg:[-5,5,10,15,15]}, rs:[["Protein (resins + filtration)",55],["Process Analytics",25],["Proteins (mass spec)",12],["Other",8]], geo:[["US",42],["Europe",28],["APAC",30]], tc:[["Biologics CDMOs (Lonza/Catalent/Samsung Bio)",28],["Top-20 biopharma",42],["Mid/small biotech",18],["Academic/research",12]], pl:[{name:"Protein A resins",desc:"mAb capture chromatography · category leader",pos:"Category monopoly"},{name:"Atoll single-use bioreactors",desc:"SUBs for cell culture",pos:"Growth"},{name:"Process analytics (C-Tech)",desc:"In-line protein analytics",pos:"Recurring consumables"},{name:"Avitide affinity ligands",desc:"Custom affinity chromatography · gene therapy",pos:"Differentiator"}], cp:["Cytiva (Danaher)","Sartorius","Merck KGaA (MilliporeSigma)","Thermo Fisher"], ops:{hq:"Waltham, MA",fd:1981,emp:2700,ne:"Early May 2026"}, own:{insider:.3,institutional:93} },
  { t:"BDX", themes:["biotech"], cc:"🇺🇸", nm:"Becton Dickinson", v:"devices", s:"Pens", r:20000, g:44, mc:65000, pe:18, pr:"Needles · Syringes · Autoinjectors · Lab", d:"Largest medical device company by revenue. Major needle/syringe maker serving injectable GLP-1 market. Also diagnostics. Defensive compounder.", ri:["FX headwinds","Slow device upgrade cycle"], ca:["GLP-1 needle volume","Diagnostics growth"], dc:{f:3800,gr:5,w:8,tg:2,sh:290}, ms:{mr:.4,ip:.3,ad:.8,ra:.4}, fin:{beta:0.5,eps:12.50,div:3.96,rg:[2,4,5,6,6]}, rs:[["BD Medical",48],["BD Life Sciences",30],["BD Interventional",22]], geo:[["US",54],["Europe",21],["APAC",17],["LatAm",8]], tc:[["US hospital networks",42],["International hospital networks",28],["Diagnostic labs",15],["Distribution",15]], pl:[{name:"Pre-filled syringes (PFS)",desc:"GLP-1 fill volume · critical supply · expansion",pos:"Capacity-constrained"},{name:"Vascular access",desc:"PICC lines + ports · BD Interventional",pos:"Franchise"},{name:"BD Alaris infusion pumps",desc:"Post-recall re-entry · share recovery",pos:"Recovery"},{name:"Medication management systems",desc:"Pyxis + BD Rowa automation",pos:"Growth"},{name:"Diagnostic systems (BD MAX)",desc:"Molecular dx + flow cytometry",pos:"Life sciences"},{name:"Biosciences spin (proposed)",desc:"Proposed 2026 separation of Life Sciences",pos:"Strategic rev"}], cp:["WST","CTLT","Medline (pvt)","BSX","TMO"], ops:{hq:"Franklin Lakes, NJ",fd:1897,emp:70000,ne:"Early May 2026"}, own:{insider:.1,institutional:93} },
  { t:"WST", themes:["biotech"], cc:"🇺🇸", nm:"West Pharmaceutical", v:"devices", s:"Autoinjectors", r:3000, g:35, mc:24000, pe:35, pr:"Vial stoppers · autoinjector components", d:"Dominant rubber stoppers and plunger seals for injectable pharma. Every GLP-1 vial, pen, autoinjector uses West components.", ri:["Bioprocessing destocking","Pen pricing compression"], ca:["GLP-1 pen component pull","Pre-filled syringe growth"], dc:{f:550,gr:5,w:9,tg:2,sh:73}, ms:{mr:.4,ip:.3,ad:.85,ra:.4}, fin:{beta:1.0,eps:6.40,div:.84,rg:[-2,5,8,10,10]}, rs:[["Proprietary Products (stoppers + seals)",78],["Contract-Mfg Services",22]], geo:[["Americas",43],["Europe",38],["APAC",19]], tc:[["Top biopharma (Pfizer/LLY/NVO)",55],["Mid-sized biotech",22],["Diagnostics/vaccines",15],["Distribution",8]], pl:[{name:"FluroTec elastomer stoppers",desc:"Injectable drug seals · GLP-1 volume catalyst",pos:"Category leader"},{name:"NovaPure / Daikyo premium",desc:"Premium elastomer · high-volume biologics",pos:"Growth"},{name:"Crystal Zenith (CZ) vials",desc:"Cyclic olefin polymer · glass alternative",pos:"Differentiation"},{name:"SmartDose wearable injector",desc:"On-body drug delivery · partnered with LLY",pos:"Growth"},{name:"Self-injection systems",desc:"Auto-injectors for biologics",pos:"Franchise"}], cp:["BDX","Gerresheimer","SCHOTT","Stevanato","Datwyler"], ops:{hq:"Exton, PA",fd:1923,emp:9500,ne:"Mid May 2026"}, own:{insider:.3,institutional:96} },

  /* ═══════════════ BATTERIES · CELLS & INTEGRATORS ═══════════════ */
  { t:"PANW_BAT", themes:["batteries"], cc:"🇰🇷", nm:"LG Energy Solution (ADR proxy)", v:"cells", s:"Li-ion", r:22000, g:12, mc:85000, pe:30, pr:"NCM Li-ion cells · Ultium (GM) · Prismatic", d:"Second-largest cell maker globally. Ultium JV with GM, also supplies Tesla, Stellantis, Ford. Proxy entry for non-ADR company.", ri:["EV demand slowdown","Margin compression"], ca:["US IRA manufacturing","Energy storage pivot"], dc:{f:800,gr:10,w:10,tg:2,sh:230}, ms:{li:.9,ev:.95,gr:.7,cn:.4}, fin:{beta:1.3,eps:1.80,div:0,rg:[5,15,20,18,12]} },
  { t:"LGEM", themes:["batteries"], cc:"🇰🇷", nm:"LG Chem", v:"cells", s:"LFP", r:40000, g:15, mc:35000, pe:15, pr:"Battery materials · Petrochemicals", d:"Parent of LG Energy. Cathode materials, ADP, cell integration. Petrochemicals weighing on conglomerate multiple.", ri:["Petrochem cycle","Korean chaebol discount"], ca:["Battery materials growth","Spinoff optionality"], dc:{f:1200,gr:6,w:10,tg:2,sh:71}, ms:{li:.85,ev:.9,gr:.5,cn:.5}, fin:{beta:1.2,eps:6.00,div:2.10,rg:[-5,5,10,10,8]} },
  { t:"CATL", themes:["batteries"], cc:"🇨🇳", nm:"CATL (Contemporary Amperex)", v:"cells", s:"LFP", r:60000, g:23, mc:130000, pe:18, pr:"LFP cells · Sodium-ion · Sell to Tesla, VW, BYD", d:"World's largest cell maker by volume (~37% share). LFP leader. Sodium-ion production starting. Massive scale advantage.", ri:["China geopolitical risk","Overseas tariff exposure"], ca:["LFP export premium","Sodium-ion commercialization"], dc:{f:7000,gr:15,w:11,tg:2,sh:4400}, ms:{li:.95,ev:.95,gr:.6,cn:.95}, fin:{beta:1.4,eps:12.00,div:2.50,rg:[10,25,35,30,20]}, rs:[["Power Batteries (EV)",75],["Energy Storage Systems",20],["Battery Materials & Recycling",5]], geo:[["China",65],["Europe",18],["North America",10],["Other",7]], tc:[["Tesla (Shanghai)",14],["BMW / Mercedes",11],["Stellantis",8],["Volkswagen",7],["Ford",6],["Hyundai/Kia",6],["Other OEMs",48]], pl:[{name:"Shenxing LFP",desc:"4C ultra-fast-charging LFP · 10-min 400km",pos:"#1 LFP globally"},{name:"Qilin (Cell-to-Pack)",desc:"High-density Li-ion · 255 Wh/kg",pos:"Premium"},{name:"Naxtra Sodium-ion",desc:"Second-gen sodium · 2026 production",pos:"First at scale"},{name:"TNS Energy Storage",desc:"BESS containers · EnerOne/EnerD/EnerC",pos:"Global BESS #1"},{name:"MTB platform",desc:"Modular battery-chassis for Stellantis/Changan",pos:"Vehicle integration"}], cp:["LGEM","PANW_BAT","BYD","Panasonic","Samsung SDI","SK On","QS","SLDP"], ops:{hq:"Ningde, China",fd:2011,emp:118000,mfg:["Ningde","Liyang","Yibin","Thuringia DE","Debrecen HU"],ne:"Late Apr 2026"}, own:{insider:30,institutional:40} },
  { t:"FLNC", themes:["batteries"], cc:"🇺🇸", nm:"Fluence Energy", v:"integrators", s:"Utility BESS", r:2700, g:12, mc:3500, pe:null, pr:"Gridstack utility BESS · AI bidding software", d:"Joint venture spinoff of Siemens + AES. Pure-play utility-scale BESS integrator. Software (Mosaic) for market participation.", ri:["Customer mix shifting","Project timing"], ca:["US utility BESS pipeline","Siemens/AES partnership"], dc:{f:-50,gr:25,w:12,tg:3,sh:180}, ms:{li:.7,ev:.3,gr:.95,cn:.6}, fin:{beta:2.0,eps:-.30,div:0,rg:[15,25,40,50,40]}, rs:[["Solutions (integrated BESS)",78],["Services (O&M + recurring)",22]], geo:[["North America",60],["Europe",25],["APAC",10],["ROW",5]], tc:[["AES (anchor shareholder customer)",18],["Siemens (anchor)",12],["Enel",10],["Dominion",8],["Other utilities",52]], pl:[{name:"Gridstack",desc:"Utility-scale BESS · 500 MWh+ projects",pos:"Market leader"},{name:"Mosaic Software",desc:"Market-participation AI · bidding optimization",pos:"Software layer"},{name:"Fluence OS",desc:"Controls platform · flagship EMS",pos:"Recurring revenue"},{name:"Nispera (asset mgmt)",desc:"Asset performance management · acquired",pos:"Services growth"}], cp:["STEM","TSLA Megapack","Wartsila","Sungrow"], ops:{hq:"Arlington, VA",fd:2018,emp:1100,bl:{label:"Backlog",val:4.9,unit:"B"},ne:"May 2026"}, own:{insider:70,institutional:22} },
  { t:"STEM", themes:["batteries"], cc:"🇺🇸", nm:"Stem Inc", v:"integrators", s:"C&I", r:450, g:10, mc:100, pe:null, pr:"Athena AI platform · C&I storage · AlsoEnergy", d:"Commercial & industrial energy storage with AI platform (Athena). Financial distress — restructuring.", ri:["Going concern","Balance sheet pressure"], ca:["Potential restructure","AI platform monetization"], dc:{f:-60,gr:0,w:22,tg:3,sh:160}, ms:{li:.6,ev:.2,gr:.85,cn:.5}, fin:{beta:3.0,eps:-1.00,div:0,rg:[-50,-20,0,30,10]}, rs:[["Hardware",55],["Services & Software (Athena)",45]], geo:[["US",85],["Canada",8],["UK/Europe",7]], tc:[["C&I customers (direct)",45],["Developer partners",25],["Utilities",15],["IPPs",10],["Other",5]], pl:[{name:"Athena Platform",desc:"AI bidding + optimization · pure software",pos:"Pivot to SaaS"},{name:"AlsoEnergy PowerTrack",desc:"Asset management SaaS · acquired 2022",pos:"Platform asset"},{name:"Stem Storage",desc:"Turnkey BESS for C&I",pos:"Declining"},{name:"Stem Solar",desc:"Solar asset management",pos:"Expansion"}], cp:["FLNC","TSLA (Megapack)","Generac","SunPower"], ops:{hq:"Broomfield, CO",fd:2009,emp:400,ne:"May 2026 (under strategic review)"}, own:{insider:2,institutional:55} },
  { t:"BE", themes:["batteries"], cc:"🇺🇸", nm:"Bloom Energy", v:"integrators", s:"Utility BESS", r:1500, g:25, mc:8000, pe:null, pr:"Solid Oxide Fuel Cell (SOFC) · Hydrogen ready", d:"SOFC + electrolyzer player. AI datacenter power bridge angle — fast deploy behind-the-meter. AEP datacenter deal.", ri:["Gas dependency","Hydrogen timeline"], ca:["Datacenter deployments","Electrolyzer pivot"], dc:{f:-50,gr:25,w:14,tg:3,sh:230}, ms:{li:.2,ev:.1,gr:.8,cn:.3}, fin:{beta:2.5,eps:-.80,div:0,rg:[-10,15,30,40,30]}, rs:[["Product (Energy Servers)",62],["Service (long-term contracts)",23],["Installation",10],["Electricity",5]], geo:[["US",78],["Korea",15],["Other (India, Europe)",7]], tc:[["Data Center customers (AEP, Equinix)",28],["AT&T / telecom",18],["Walmart / retail",12],["Korea Hydro",12],["Other",30]], pl:[{name:"Bloom Energy Server",desc:"Solid Oxide Fuel Cell · natural gas / hydrogen ready",pos:"Category pioneer"},{name:"Bloom Electrolyzer",desc:"SOEC hydrogen production · MWt-scale",pos:"Future growth"},{name:"AEP Data Center Deal",desc:"Multi-GW AI data center deployment · Nov 2024",pos:"Flagship DC contract"},{name:"Combined Heat & Power",desc:"CHP integration for industrials",pos:"Diversification"}], cp:["Plug Power","Ballard (BLDP)","GE Power","Cummins"], ops:{hq:"San Jose, CA",fd:2001,emp:2100,ne:"May 2026"}, own:{insider:5,institutional:65} },
  { t:"NVEE", themes:["batteries"], cc:"🇺🇸", nm:"NV5 Global", v:"integrators", s:"Residential", r:900, g:16, mc:1500, pe:22, pr:"Engineering & consulting · Storage siting", d:"Engineering services for power/storage infrastructure. Exposure to datacenter + utility BESS siting. Smaller industrial services name.", ri:["Small scale","Acquisition pipeline"], ca:["DC infrastructure siting","Grid modernization engineering"], dc:{f:50,gr:10,w:11,tg:2,sh:15}, ms:{li:.3,ev:.2,gr:.7,cn:.3}, fin:{beta:1.2,eps:3.50,div:0,rg:[3,5,8,10,10]} },
  { t:"ALB", themes:["batteries","uranium"], cc:"🇺🇸", nm:"Albemarle", v:"materials", s:"Cathode", r:5500, g:20, mc:12000, pe:null, pr:"Lithium · Bromine · Catalysts", d:"Largest Western lithium producer. Has taken huge hits on Li price collapse. Still core pure-play for exposure to lithium recovery.", ri:["Lithium price volatility","Capex overhang"], ca:["Lithium price recovery","Long-term EV demand"], dc:{f:-100,gr:20,w:11,tg:2,sh:118}, ms:{li:.95,ev:.85,gr:.5,cn:.6,up:.1,gp:.4,pl:.5,dm:.9}, fin:{beta:1.4,eps:-.80,div:1.62,rg:[-50,-20,15,30,30]}, rs:[["Energy Storage (lithium)",52],["Specialties",28],["Ketjen (catalysts)",18],["Other",2]], geo:[["Chile (Atacama)",32],["US (Silver Peak + conversion)",25],["Australia (Wodgina/Greenbushes)",22],["China (conversion)",14],["Other",7]], tc:[["LGES",18],["CATL",12],["Panasonic/Tesla",10],["SK On",9],["Chinese cell-makers",15],["Other",36]], pl:[{name:"La Negra (Chile)",desc:"World-class brine · Atacama · 85 Mlb/yr",pos:"Tier-1 resource"},{name:"Greenbushes (JV 49%)",desc:"World's largest hard-rock lithium · Australia",pos:"JV asset"},{name:"Kemerton conversion",desc:"Australian conversion plant",pos:"Key downstream"},{name:"Meishan/Nanchang (China)",desc:"Conversion plants · spodumene → carbonate",pos:"Integration"},{name:"Bromine (Specialties)",desc:"Flame retardants + oilfield",pos:"Cash cow"}], cp:["SQM","PLL","LAC","Tianqi","Ganfeng","Mineral Resources"], ops:{hq:"Charlotte, NC",fd:1994,emp:9300,ne:"May 2026"}, own:{insider:.1,institutional:95} },
  { t:"PLL", themes:["batteries"], cc:"🇺🇸", nm:"Piedmont Lithium", v:"materials", s:"Cathode", r:80, g:10, mc:400, pe:null, pr:"Sayona merger · North American lithium", d:"North Carolina spodumene project + Sayona (Québec) JV. Potential tariff beneficiary. Recent share consolidation.", ri:["Merger execution","Li price"], ca:["US permit completion","Tariff benefit"], dc:{f:-40,gr:50,w:16,tg:3,sh:80}, ms:{li:.95,ev:.8,gr:.3,cn:.4}, fin:{beta:2.5,eps:-1.20,div:0,rg:[-40,-20,30,80,80]} },
  { t:"MP", themes:["batteries","uranium"], cc:"🇺🇸", nm:"MP Materials", v:"materials", s:"Anode", r:230, g:20, mc:4500, pe:null, pr:"Mountain Pass REE mine · Magnet manufacturing (TX)", d:"Only scaled US rare earths producer. Neodymium magnets → EV motors, MRI, drones. Tariff + DoD-funded ramp.", ri:["China price swings","Magnet ramp delays"], ca:["Magnet plant ramp","Apple + GM offtake"], dc:{f:-40,gr:50,w:12,tg:3,sh:180}, ms:{li:.4,ev:.8,gr:.6,cn:.9,up:.2,gp:.95,pl:.85,dm:.9}, fin:{beta:1.8,eps:-.30,div:0,rg:[-20,20,50,80,60]}, rs:[["Materials (concentrate + oxides)",65],["Magnetics (NdPr metals/alloys)",35]], geo:[["US",60],["Japan (Shenghe contract)",25],["Other",15]], tc:[["Shenghe (offtake)",55],["GM (10-yr supply deal)",20],["Apple (rare earths deal)",10],["DoD",10],["Other",5]], pl:[{name:"Mountain Pass Mine",desc:"Only scaled US rare earth mine · California",pos:"Strategic US asset"},{name:"Stage II Concentrate",desc:"Bastnäsite concentrate · shipped to Shenghe",pos:"Current revenue"},{name:"Stage III Magnetics",desc:"Neodymium iron boron magnets · Fort Worth TX · GM anchor",pos:"Ramp 2026"},{name:"DoD $58.5M grant",desc:"Heavy rare earth separation at Mtn Pass",pos:"Funding"}], cp:["Lynas (pvt) ASX","China Northern Rare Earth","USA Rare Earth (pvt)"], ops:{hq:"Las Vegas, NV",fd:2017,emp:800,ne:"May 2026"}, own:{insider:3,institutional:70} },
  { t:"ENPH", themes:["batteries"], cc:"🇺🇸", nm:"Enphase Energy", v:"grid", s:"Inverters", r:1400, g:47, mc:9000, pe:55, pr:"Microinverters · IQ batteries · Bidirectional EV", d:"Leading residential microinverter maker. IQ residential battery. Bidirectional EV charging (Gen 4). Stock hit by residential solar slump.", ri:["Residential solar demand","Tariff uncertainty"], ca:["Residential recovery","Bidirectional EV charging"], dc:{f:-50,gr:25,w:12,tg:3,sh:135}, ms:{li:.5,ev:.4,gr:.8,cn:.5}, fin:{beta:2.0,eps:1.00,div:0,rg:[-40,10,30,50,35]}, rs:[["Microinverters",62],["IQ Batteries",28],["Other (EV charging, cables)",10]], geo:[["US",73],["Europe",17],["ROW",10]], tc:[["SunPower/solar installers",25],["Home Depot / Lowe's retail",18],["Solar dealer network",40],["Wholesale",12],["Direct",5]], pl:[{name:"IQ8 Microinverter",desc:"Latest-gen · grid-forming capability",pos:"Market leader"},{name:"IQ Battery 5P/10T",desc:"Residential battery · lithium iron phosphate",pos:"Residential BESS"},{name:"IQ EV Charger",desc:"Bidirectional EV charging · V2H/V2G",pos:"Emerging"},{name:"Solargraf Design",desc:"Installer design software · acquired",pos:"Software"}], cp:["SEDG","TSLA (Powerwall)","FSLR","Emerging Chinese makers"], ops:{hq:"Fremont, CA",fd:2006,emp:4500,ne:"May 2026"}, own:{insider:1,institutional:80} },
  { t:"SEDG", themes:["batteries"], cc:"🇮🇱", nm:"SolarEdge Technologies", v:"grid", s:"Inverters", r:700, g:8, mc:1000, pe:null, pr:"String inverters · batteries · EV charging", d:"String inverter + residential battery. Hit very hard by residential solar collapse. Restructuring. Lazarus story potential.", ri:["Inventory destocking","Balance sheet"], ca:["Residential recovery","Operational restructure"], dc:{f:-80,gr:0,w:18,tg:3,sh:58}, ms:{li:.5,ev:.3,gr:.7,cn:.4}, fin:{beta:2.5,eps:-5.00,div:0,rg:[-70,-40,0,30,20]}, rs:[["Solar Inverters",68],["Energy Storage",20],["Other (e-Mobility, Critical Power)",12]], geo:[["US",32],["Europe",50],["ROW",18]], tc:[["European installers",45],["US installers",30],["Wholesale",15],["Utility projects",10]], pl:[{name:"Solar Inverters",desc:"Three-phase + single-phase · residential/commercial",pos:"Historical leader"},{name:"Home Battery",desc:"Backup + self-consumption · EU focus",pos:"Recovery play"},{name:"Commercial Inverters",desc:"C&I three-phase · high-kW",pos:"Growth"},{name:"E-Mobility (Croatia)",desc:"EV charging · de-prioritized",pos:"Wind-down"}], cp:["ENPH","FSLR","Sungrow","Growatt"], ops:{hq:"Herzliya, Israel",fd:2006,emp:4200,ne:"May 2026"}, own:{insider:1,institutional:90} },
  { t:"FSLR", themes:["batteries"], cc:"🇺🇸", nm:"First Solar", v:"grid", s:"EMS", r:4200, g:45, mc:25000, pe:15, pr:"CdTe utility PV panels · US manufacturing", d:"US thin-film (CdTe) utility solar. IRA manufacturing tax credit beneficiary. US DOE funding. Not storage directly but solar+storage PPA.", ri:["Tariff policy shifts","Module ASP"], ca:["IRA 45X tax credits","US manufacturing footprint"], dc:{f:1200,gr:15,w:9,tg:2,sh:107}, ms:{li:.3,ev:.1,gr:.9,cn:.7}, fin:{beta:1.5,eps:16.00,div:0,rg:[15,25,30,25,20]}, rs:[["Module sales (CdTe)",100]], geo:[["US",67],["India",18],["Europe",10],["Other",5]], tc:[["Utility-scale developers",75],["Independent power producers",18],["Corporate PPAs",7]], pl:[{name:"Series 7 (CdTe thin-film)",desc:"US-made · 3rd-gen thin film · 550W+ modules",pos:"#1 US thin-film"},{name:"Series 6 Plus",desc:"Previous-gen workhorse · still shipping",pos:"Franchise"},{name:"US IRA 45X tax credits",desc:"Manufacturing tax credit cash flow",pos:"Tailwind through 2030"},{name:"Ohio + Louisiana factories",desc:"US manufacturing capacity ~14 GW",pos:"Strategic moat"},{name:"TOPCon R&D",desc:"Next-gen thin-film research",pos:"Future"}], cp:["ENPH","SEDG","Chinese makers (LONGi, Jinko)","Canadian Solar"], ops:{hq:"Tempe, AZ",fd:1999,emp:7500,bl:{label:"Contract book",val:79,unit:"B"},ne:"May 2026"}, own:{insider:.5,institutional:87} },

  /* ═══════════════ URANIUM-ADJACENT MINERS & ETFs ═══════════════ */
  { t:"NXE", themes:["uranium","nuclear"], cc:"🇨🇦", nm:"NexGen Energy", v:"uranium", s:"Developer", r:0, g:null, mc:5500, pe:null, pr:"Rook I / Arrow uranium project · Saskatchewan", d:"Premier Athabasca Basin uranium developer. Arrow deposit = world's largest undeveloped high-grade U3O8 deposit. Targeting first production late decade.", ri:["Permitting timeline","Financing execution"], ca:["Saskatchewan approval","First offtake sales"], dc:{f:-50,gr:null,w:15,tg:3,sh:570}, ms:{up:.95,gp:.6,pl:.8,dm:.9}, fin:{beta:2.2,eps:-.10,div:0,rg:[0,30,80,120,80]}, rs:[["Pre-revenue (exploration/development)",100]], geo:[["Canada (Athabasca Basin)",100]], tc:[["Future long-term offtake pipeline (utilities)",100]], pl:[{name:"Arrow Deposit",desc:"World's largest undeveloped high-grade U · 3.75 Mlb/yr",pos:"Crown jewel"},{name:"Rook I Project",desc:"Saskatchewan basin · 25-year mine life",pos:"Development plan"},{name:"Federal approval Nov 2023",desc:"Environmental review complete",pos:"De-risked"},{name:"Offtake agreements",desc:"~30M lb secured to date",pos:"Pre-production revenue"}], cp:["CCJ","DNN","UEC","PDN","BOE","KAP"], ops:{hq:"Vancouver, BC, Canada",fd:2011,emp:65,ne:"May 2026"}, own:{insider:5,institutional:75} },
  { t:"UUUU", themes:["uranium"], cc:"🇺🇸", nm:"Energy Fuels", v:"uranium", s:"Producer", r:120, g:30, mc:1400, pe:null, pr:"US conventional uranium · Rare earth monazite sands", d:"Only US conventional uranium mill (White Mesa, UT) + REE processing. Vanadium option. Diversified US domestic critical minerals play.", ri:["Processing complexity","REE prices"], ca:["DOE uranium reserve","REE revenue ramp"], dc:{f:-10,gr:50,w:14,tg:3,sh:200}, ms:{up:.9,gp:.7,pl:.9,dm:.85}, fin:{beta:2.0,eps:-.10,div:0,rg:[-20,20,60,100,60]}, rs:[["Uranium + Vanadium concentrate",60],["Rare Earths (monazite → mixed REE concentrate)",25],["Medical isotopes (Ra-226)",5],["Other (Alternate feed)",10]], geo:[["US (Utah + Wyoming)",85],["International monazite inputs",15]], tc:[["Utilities (spot/LT)",45],["Rare earth customers",30],["Medical isotope partners",15],["Other",10]], pl:[{name:"White Mesa Mill (UT)",desc:"Only US conventional uranium mill · multi-purpose",pos:"Strategic monopoly"},{name:"Nichols Ranch (WY)",desc:"ISR uranium · restarted",pos:"Producer"},{name:"Monazite → REE Oxides",desc:"Neodymium/praseodymium from monazite",pos:"REE pivot"},{name:"Donald Project (Australia JV)",desc:"Heavy mineral sands · REE-bearing",pos:"Intl REE"},{name:"Ra-226 / medical isotopes",desc:"Targeted alpha therapy supply",pos:"High-margin niche"}], cp:["MP","Lynas (pvt)","UEC","URG","CCJ"], ops:{hq:"Lakewood, CO",fd:1987,emp:150,ne:"May 2026"}, own:{insider:3,institutional:45} },
  { t:"LAC", themes:["uranium"], cc:"🇺🇸", nm:"Lithium Americas", v:"rare_earths", s:"Lithium", r:0, g:null, mc:800, pe:null, pr:"Thacker Pass lithium (NV) · GM-funded", d:"Thacker Pass, Nevada — largest US lithium resource. GM $650M + DoE $2.26B loan. Pre-revenue, targeting first production 2027.", ri:["Construction execution","Li price trough"], ca:["First production 2027","GM long-term offtake"], dc:{f:-150,gr:null,w:16,tg:3,sh:220}, ms:{up:.1,gp:.8,pl:.85,dm:.8}, fin:{beta:2.5,eps:-.30,div:0,rg:[0,0,0,50,200]}, rs:[["Pre-revenue (Thacker Pass development)",100]], geo:[["US (Nevada)",100]], tc:[["GM (10-yr offtake)",100]], pl:[{name:"Thacker Pass (phase 1)",desc:"40k tonnes/yr Li carbonate · first North American scale Li · GM anchor",pos:"Strategic US asset"},{name:"Phase 2 expansion",desc:"Doubling to 80k tonnes/yr",pos:"Future"},{name:"DOE loan ($2.3B closed)",desc:"ATVM loan for Phase 1 construction",pos:"Financing"},{name:"GM 10-yr offtake",desc:"$625M GM investment · 100% offtake",pos:"Bankability"}], cp:["ALB","SQM","PLL","PLS","MIN"], ops:{hq:"Vancouver, BC, Canada",fd:2023,emp:120,ne:"May 2026"}, own:{insider:38,institutional:40} },
  { t:"URA", themes:["uranium"], cc:"🇺🇸", nm:"Global X Uranium ETF", v:"royalty", s:"ETF", r:null, g:null, mc:3500, pe:null, pr:"Basket of uranium miners & enrichers", d:"Most liquid uranium-themed ETF. Holds CCJ, NXE, UEC, URG, DNN, CAMECO, KAP, plus enrichment names. Passive exposure vehicle.", ri:["Concentration in top 3 names","Fee drag"], ca:["Uranium sector rally","Fund flows"], dc:{f:null,gr:null,w:null,tg:null,sh:null}, ms:{up:.95,gp:.7,pl:.8,dm:.9}, fin:{beta:1.8,eps:null,div:.90,rg:[-20,10,30,40,25]}, rs:[["Passive fund holdings (uranium-exposed equities)",100]], geo:[["Canada (CCJ ~22%)",30],["Kazakhstan (KAP)",15],["US",25],["Australia",15],["Other",15]], tc:[["ETF investors (retail + institutional)",100]], pl:[{name:"CCJ (~22% weight)",desc:"Top holding · ~22% of fund",pos:"Anchor"},{name:"KAP / NXE / CCJ / PDN / BOE / DNN",desc:"Top 6 = ~55% of fund",pos:"Core"},{name:"NACG (Global X family)",desc:"Mining services adjacency",pos:"Diversifier"},{name:"OKLO / SMR",desc:"SMR developer exposure",pos:"Thematic"}], cp:["SPUT","NUKZ (nuclear ETF)","HURA (Horizons)","URNM (North Shore)"], ops:{hq:"New York, NY (Global X)",fd:2010,emp:null,ne:"N/A (ETF)"}, own:{insider:0,institutional:null} },
  { t:"SPUT", themes:["uranium"], cc:"🇨🇦", nm:"Sprott Physical Uranium Trust", v:"royalty", s:"Holding", r:null, g:null, mc:5000, pe:null, pr:"Physical U3O8 holding vehicle", d:"Closed-end fund holding physical uranium pounds. Most direct pure-play exposure to U3O8 spot price. Drove uranium squeeze in 2021-2022.", ri:["Premium/discount to NAV","Taxation treatment"], ca:["U3O8 spot rally","At-the-market offerings"], dc:{f:null,gr:null,w:null,tg:null,sh:null}, ms:{up:.98,gp:.5,pl:.6,dm:.9}, fin:{beta:1.6,eps:null,div:0,rg:[-10,15,40,55,30]}, rs:[["Physical U3O8 holdings (closed-end trust)",100]], geo:[["US + Canadian converter storage",100]], tc:[["Trust unitholders",100]], pl:[{name:"Physical U3O8",desc:"~67M lb U3O8 · stored at Cameco/Orano",pos:"Most direct U price exposure"},{name:"ATM Issuance",desc:"At-the-market unit issuance to buy more U3O8",pos:"Price squeeze mechanism"},{name:"Sprott Management",desc:"Sprott Asset Management fund family",pos:"Operator"}], cp:["URA","URNM","URNJ","Yellow Cake plc"], ops:{hq:"Toronto, ON, Canada (Sprott)",fd:2021,emp:null,ne:"N/A (trust)"}, own:{insider:.1,institutional:80} },

  /* ═══════════════ CRYPTO INFRASTRUCTURE ═══════════════ */
  { t:"MARA", themes:["crypto"], cc:"🇺🇸", nm:"Marathon Digital", v:"miners", s:"Scaled", r:650, g:35, mc:5500, pe:null, pr:"BTC mining · ~53 EH/s hashrate · AI hosting pivot", d:"Largest US BTC miner by hashrate. ~900 BTC treasury. Announced AI compute hosting expansion. Texas mega-site.", ri:["BTC price volatility","Hashprice compression"], ca:["AI hosting monetization","Post-halving efficiency"], dc:{f:-200,gr:50,w:15,tg:3,sh:310}, ms:{bt:.95,rg:.6,in:.6,ra:.5}, fin:{beta:3.5,eps:-1.00,div:0,rg:[-30,80,150,100,50]}, rs:[["BTC Mining",90],["Energy Harvesting + Hosting",10]], geo:[["US (TX primary)",88],["UAE",8],["Paraguay",4]], tc:[["Self-mining (BTC sold to market)",90],["Hosting (minor)",6],["Methane-capture",4]], pl:[{name:"Granbury TX Site",desc:"300 MW flagship BTC mine",pos:"Flagship"},{name:"Kaspa altcoin mining",desc:"Diversification via Kaspa",pos:"Experimentation"},{name:"MARA Balance Sheet BTC",desc:"~50,000+ BTC holdings",pos:"Top corporate holder"},{name:"2Ptr ASIC manufacturing",desc:"Self-designed ASIC strategy · delayed",pos:"Strategic R&D"},{name:"Methane capture pilots",desc:"Flare gas-to-compute conversion · North Dakota",pos:"ESG angle"}], cp:["RIOT","CLSK","IREN","CIFR","HUT","WULF","BTDR"], ops:{hq:"Fort Lauderdale, FL",fd:2010,emp:75,ne:"May 2026"}, own:{insider:5,institutional:42} },
  { t:"RIOT", themes:["crypto"], cc:"🇺🇸", nm:"Riot Platforms", v:"miners", s:"Scaled", r:420, g:25, mc:3500, pe:null, pr:"BTC mining · Corsicana TX site · AI pivot", d:"Second-largest US BTC miner. 33 EH/s. Self-owned 1 GW Texas site (Corsicana) = AI hosting optionality. Public shareholder since 2017.", ri:["Hashprice compression","Texas power price"], ca:["AI hosting optionality","ERCOT demand response"], dc:{f:-150,gr:30,w:15,tg:3,sh:290}, ms:{bt:.95,rg:.6,in:.6,ra:.5}, fin:{beta:3.2,eps:-.80,div:0,rg:[-30,60,120,90,50]}, rs:[["BTC Mining (self)",70],["Engineering / E&I services",20],["Hosting",10]], geo:[["US (TX Corsicana + Rockdale)",100]], tc:[["Self-mining",70],["Engineering services",20],["Third-party hosting",10]], pl:[{name:"Corsicana TX (1 GW)",desc:"Self-owned · half for BTC, half to convert to HPC",pos:"Strategic land asset"},{name:"Rockdale TX (700 MW)",desc:"Legacy flagship · immersion cooling",pos:"Core mining"},{name:"ESS Metron",desc:"Electrical engineering acquisition",pos:"Service business"},{name:"HPC Conversion (Corsicana)",desc:"Mixed BTC + high-performance compute",pos:"2026 pivot"}], cp:["MARA","CLSK","IREN","CIFR","HUT","WULF"], ops:{hq:"Castle Rock, CO",fd:2000,emp:450,ne:"May 2026"}, own:{insider:3,institutional:38} },
  { t:"CLSK", themes:["crypto"], cc:"🇺🇸", nm:"CleanSpark", v:"miners", s:"Scaled", r:380, g:40, mc:2500, pe:null, pr:"BTC mining · Georgia · Wyoming · Mississippi sites", d:"Mid-cap BTC miner with strong unit economics. 32 EH/s. Acquisitive — rolled up smaller miners 2023-2024. Georgia power cost advantage.", ri:["Regulatory scrutiny","Hashprice"], ca:["Post-halving efficiency","Hashrate ramp"], dc:{f:-80,gr:45,w:14,tg:3,sh:250}, ms:{bt:.95,rg:.5,in:.5,ra:.5}, fin:{beta:3.0,eps:-.50,div:0,rg:[-20,50,100,80,60]}, rs:[["BTC Mining",95],["Hosting",5]], geo:[["US (GA + WY + MS)",100]], tc:[["Self-mining (BTC sold)",95],["Third-party hosting",5]], pl:[{name:"Georgia Sites (4)",desc:"Norcross, Washington, College Park · legacy",pos:"Original footprint"},{name:"Wyoming Site",desc:"Cheyenne · 300 MW · cheap power",pos:"Growth"},{name:"Mississippi Site",desc:"Diversification · 2024 acquisition",pos:"Expansion"},{name:"Submer liquid cooling",desc:"Liquid-cooled HPC partnership · AI pivot path",pos:"New direction"}], cp:["MARA","RIOT","IREN","HUT","WULF","CIFR"], ops:{hq:"Las Vegas, NV",fd:1987,emp:340,ne:"May 2026"}, own:{insider:5,institutional:65} },
  { t:"HUT", themes:["crypto"], cc:"🇨🇦", nm:"Hut 8 Mining", v:"miners", s:"AI Pivot", r:170, g:25, mc:2000, pe:null, pr:"BTC mining · AI compute hosting (Highrise + GPU)", d:"Merged with US Bitcoin Corp. AI hosting pivot most aggressive of the group — signed deals with AI-compute tenants. Nvidia GPU partnership.", ri:["AI tenant risk","BTC dilution of AI narrative"], ca:["AI revenue ramp","GPU-as-a-service launch"], dc:{f:-50,gr:40,w:14,tg:3,sh:100}, ms:{bt:.75,rg:.5,in:.6,ra:.5}, fin:{beta:3.0,eps:-.40,div:0,rg:[-20,40,100,100,70]}, rs:[["BTC Mining (self)",35],["High Performance Compute (AI)",40],["Hosting",15],["Other (Helios)",10]], geo:[["US (TX + NY)",60],["Canada (Medicine Hat, Drumheller)",40]], tc:[["Fluidstack (Google-backed AI)",30],["Self-mining",35],["Existing HPC customers",15],["Third-party hosting",15],["Other",5]], pl:[{name:"Vega TX site",desc:"AI/HPC focus · 205 MW · Fluidstack",pos:"AI pivot flagship"},{name:"Medicine Hat (Canada)",desc:"310 MW self-mining",pos:"Heritage mining"},{name:"HPC Cluster NY",desc:"Kearney Niagara · HPC hosting",pos:"Growth"},{name:"US Bitcoin Corp merger assets",desc:"Post-2023 merger · King Mountain + Niagara",pos:"Scale"}], cp:["IREN","CIFR","WULF","MARA","RIOT","APLD"], ops:{hq:"Miami, FL",fd:2018,emp:200,ne:"May 2026"}, own:{insider:8,institutional:50} },
  { t:"BITF", themes:["crypto"], cc:"🇨🇦", nm:"Bitfarms Ltd", v:"miners", s:"Scaled", r:170, g:22, mc:900, pe:null, pr:"BTC mining · Argentina · Paraguay · Canada sites", d:"International BTC miner with cheap LATAM power. Argentina hydro. Activist ownership (Riot stake). Undergoing strategic review.", ri:["LATAM political","Hashprice"], ca:["Strategic review outcome","Argentina expansion"], dc:{f:-30,gr:30,w:15,tg:3,sh:510}, ms:{bt:.95,rg:.6,in:.4,ra:.5}, fin:{beta:3.2,eps:-.10,div:0,rg:[-20,40,80,70,40]}, rs:[["BTC Mining",88],["Hosting",12]], geo:[["Argentina",35],["Paraguay",25],["Canada (QC + Washington State)",40]], tc:[["Self-mining",88],["Third-party hosting",12]], pl:[{name:"Rio Cuarto (Argentina)",desc:"50 MW · hydro-powered",pos:"LATAM footprint"},{name:"Villa Rica (Paraguay)",desc:"Hydro-powered · low-cost",pos:"Key site"},{name:"Quebec sites (4)",desc:"Hydro-powered Canadian ops",pos:"Founders footprint"},{name:"Strategic Review",desc:"Activist investor pressure · RIOT stake",pos:"Potential catalyst"}], cp:["MARA","RIOT","CLSK","IREN","HUT"], ops:{hq:"Toronto, ON, Canada",fd:2017,emp:180,ne:"May 2026"}, own:{insider:3,institutional:50} },
  { t:"COIN", themes:["crypto"], cc:"🇺🇸", nm:"Coinbase Global", v:"exchanges", s:"Spot", r:6500, g:80, mc:70000, pe:45, pr:"Largest US crypto exchange · USDC · Base L2", d:"Dominant US crypto exchange. Major USDC stablecoin revenue share (via Circle). Base L2 usage. Custody + staking.", ri:["SEC regulation","Trading volume cyclicality"], ca:["Stablecoin legislation","Staking product expansion"], dc:{f:1800,gr:50,w:12,tg:3,sh:255}, ms:{bt:.85,rg:.9,in:.9,ra:.4}, fin:{beta:3.0,eps:5.50,div:0,rg:[30,80,150,100,60]}, rs:[["Transaction Fees",50],["Subscription & Services (USDC/Staking)",40],["Corporate Interest",7],["Other",3]], geo:[["US",65],["International",35]], tc:[["Retail investors",50],["Institutional clients",32],["USDC partners (Circle)",13],["Other",5]], pl:[{name:"Coinbase Exchange",desc:"Spot trading · #1 US crypto exchange",pos:"#1 US share"},{name:"USDC Revenue Share",desc:"Partnership with Circle · fed funds yield",pos:"Rate-sensitive"},{name:"Coinbase Prime",desc:"Institutional brokerage · custody · lending",pos:"Growth"},{name:"Base L2",desc:"Ethereum L2 · consumer on-chain",pos:"Flagship crypto infra"},{name:"Staking",desc:"ETH staking rewards · 25% fee",pos:"Recurring"},{name:"International Exchange",desc:"Bermuda-regulated derivatives",pos:"Expansion"}], cp:["HOOD","Binance (pvt)","Kraken (pvt)","Gemini (pvt)","CME"], ops:{hq:"Remote-first (DE inc.)",fd:2012,emp:3900,ne:"Early May 2026"}, own:{insider:8,institutional:68} },
  { t:"HOOD", themes:["crypto"], cc:"🇺🇸", nm:"Robinhood Markets", v:"exchanges", s:"Spot", r:3000, g:85, mc:40000, pe:40, pr:"Retail brokerage · Crypto trading · Gold credit card", d:"Retail brokerage with growing crypto mix. Crypto revenue share ~15-20%. Bitstamp acquisition added European crypto. Retail renaissance.", ri:["Trading volume cyclicality","Regulatory"], ca:["Stablecoin traction","International expansion"], dc:{f:1500,gr:40,w:11,tg:3,sh:880}, ms:{bt:.7,rg:.8,in:.9,ra:.4}, fin:{beta:2.5,eps:1.80,div:0,rg:[20,60,100,80,50]}, rs:[["Transaction Revenue (equities/options/crypto)",55],["Net Interest",35],["Other (Gold subscription, Credit card)",10]], geo:[["US",88],["UK",10],["EU/Canada/Australia",2]], tc:[["Retail investors (25M+)",85],["Institutional clients",8],["Payment for order flow partners",7]], pl:[{name:"Robinhood Classic",desc:"Mobile/web brokerage · core business",pos:"Flagship retail"},{name:"Robinhood Gold",desc:"Premium subscription · $5/mo · margin + API",pos:"Recurring ARR"},{name:"Robinhood Credit Card",desc:"3% cashback · Cash Card · premium tier",pos:"Growth"},{name:"Bitstamp (EU crypto)",desc:"2024 acquisition · European crypto presence",pos:"Intl expansion"},{name:"Legend / Active Trader",desc:"Day-trading platform · post-TradeStation acq",pos:"Pro tier"}], cp:["COIN","SCHW","IBKR","CME","Plus500"], ops:{hq:"Menlo Park, CA",fd:2013,emp:2400,ne:"Early May 2026"}, own:{insider:11,institutional:45} },
  { t:"MSTR", themes:["crypto"], cc:"🇺🇸", nm:"MicroStrategy (Strategy Inc)", v:"treasuries", s:"Pure Treasury", r:500, g:75, mc:90000, pe:null, pr:"BTC treasury · 580,000+ BTC holdings · Enterprise BI software", d:"Corporate BTC treasury (~580K BTC). Michael Saylor flagship. MSTR premium to NAV fluctuates. Issues equity and debt to buy more BTC.", ri:["Premium/discount to NAV","Forced deleveraging"], ca:["BTC price appreciation","Convertible issuance arbitrage"], dc:{f:-100,gr:null,w:12,tg:3,sh:190}, ms:{bt:.99,rg:.7,in:.9,ra:.5}, fin:{beta:3.5,eps:-2.00,div:0,rg:[-20,100,300,200,100]}, rs:[["Corporate BTC treasury",95],["Enterprise BI software",5]], geo:[["US-focused treasury strategy",100]], tc:[["Equity / convertible market access",100],["BI software customers (Fortune 500)",100]], pl:[{name:"BTC Treasury",desc:"580,000+ BTC · largest corporate holder · Saylor strategy",pos:"Pioneer"},{name:"ATM equity issuance",desc:"At-the-market programs to fund BTC buys",pos:"Active"},{name:"Convertible notes",desc:"Multiple tranches · 0% coupon · long duration",pos:"Capital engine"},{name:"STRIF Preferred",desc:"Hyperion preferred equity · perpetual",pos:"New capital vehicle"},{name:"MicroStrategy ONE BI",desc:"Legacy enterprise analytics software",pos:"Core cash-gen"}], cp:["SMLR","CORZ (via treasury)","Saylor-model treasury firms"], ops:{hq:"Tysons Corner, VA",fd:1989,emp:2000,bl:{label:"BTC holdings",val:580,unit:"k BTC"},ne:"May 2026"}, own:{insider:10,institutional:35} },
  { t:"SMLR", themes:["crypto"], cc:"🇺🇸", nm:"Semler Scientific", v:"treasuries", s:"Operating", r:55, g:90, mc:400, pe:null, pr:"Medical diagnostics + BTC treasury", d:"Micro-cap medical diagnostics company that pivoted to BTC treasury strategy 2024. ~3,300+ BTC. Operating biz is QuantaFlo vascular test.", ri:["Regulatory risk on pivot","Operating business decline"], ca:["BTC appreciation","Treasury expansion"], dc:{f:20,gr:10,w:15,tg:3,sh:6.5}, ms:{bt:.95,rg:.7,in:.6,ra:.5}, fin:{beta:3.0,eps:3.50,div:0,rg:[-30,50,150,100,50]}, rs:[["Medical diagnostics (QuantaFlo)",92],["BTC treasury (unrealized gains)",8]], geo:[["US (medical)",100]], tc:[["Primary care physicians (QuantaFlo rentals)",80],["VA/DoD medical",10],["Specialists",10]], pl:[{name:"QuantaFlo",desc:"Non-invasive vascular disease test · FDA-cleared",pos:"Legacy franchise"},{name:"BTC Treasury",desc:"~3,300+ BTC holdings · accretive strategy",pos:"Strategic pivot"},{name:"Insight Insurance Svc",desc:"Medical billing adjacency",pos:"Support"}], cp:["MSTR (treasury playbook)","Saylor-model firms globally"], ops:{hq:"Portland, OR",fd:2007,emp:100,ne:"May 2026"}, own:{insider:30,institutional:25} },
  { t:"GLXY", themes:["crypto"], cc:"🇨🇦", nm:"Galaxy Digital", v:"infra", s:"Custody", r:400, g:50, mc:7000, pe:null, pr:"Crypto IB + AI hosting · Helios AI DC pivot", d:"Crypto investment bank (trading, advisory, asset management). Pivoting Helios BTC mine to 800 MW AI datacenter hosting. Mike Novogratz.", ri:["Crypto cycle","AI hosting buildout risk"], ca:["Helios AI hosting","US listing transition"], dc:{f:100,gr:40,w:12,tg:3,sh:360}, ms:{bt:.7,rg:.8,in:.9,ra:.5}, fin:{beta:3.0,eps:0.80,div:0,rg:[0,40,80,80,50]}, rs:[["Global Markets (trading/IB)",45],["Asset Management",25],["Digital Infrastructure (Helios AI)",20],["Lending",10]], geo:[["North America",75],["Europe",15],["ROW",10]], tc:[["Institutional crypto clients",45],["AI hosting tenants (Helios)",22],["Asset management LPs",18],["Other",15]], pl:[{name:"Helios (West TX site)",desc:"800 MW BTC mine pivoting to AI DC hosting",pos:"Core AI pivot"},{name:"Trading (OTC + derivatives)",desc:"Institutional crypto trading desk",pos:"Historical core"},{name:"Asset Management (~$5B AUM)",desc:"Crypto-native funds · Bitcoin ETF provider",pos:"Recurring fees"},{name:"GK8 Custody",desc:"Cold storage custody acquisition",pos:"Infra"},{name:"Lending (DeFi)",desc:"Restarted after 2022 wind-down",pos:"Growing back"}], cp:["COIN","SMLR (different)","Canaan","institutional crypto IBs"], ops:{hq:"Toronto/NYC",fd:2018,emp:450,ne:"May 2026"}, own:{insider:30,institutional:30} },

  /* ═══════════════ PASS 4 COVERAGE ADDITIONS ═══════════════ */

  /* AI · SEMI EQUIPMENT & EDA (biggest gap) */
  { t:"ASML", themes:["ai"], cc:"🇳🇱", nm:"ASML Holding", v:"compute", s:"Foundry", r:31000, g:51, mc:320000, pe:32, pr:"EUV / High-NA EUV lithography systems", d:"Monopoly on EUV lithography — every leading-edge logic node (TSMC, Intel, Samsung) requires ASML tools. High-NA EUV ramping 2026-2027. Core AI-infra pick through equipment.", ri:["China export restrictions","Single-customer cluster (TSMC)"], ca:["High-NA EUV adoption","AI capex cycle"], dc:{f:9000,gr:12,w:9,tg:3,sh:390}, ms:{ta:.7,ch:.85,ai:.95,ra:.4}, fin:{beta:1.1,eps:24.00,div:6.50,rg:[8,15,20,18,15]}, rs:[["EUV lithography",58],["DUV lithography",25],["Applications/metrology (inc. HMI)",8],["Installed Base (service+upgrades)",9]], geo:[["Taiwan (TSMC)",38],["Korea (Samsung/SK)",23],["US (Intel)",15],["China (legacy DUV)",22],["Other",2]], tc:[["TSMC",30],["Samsung Foundry",20],["Intel Foundry",14],["SK Hynix",10],["Micron",6],["Chinese customers",15],["Other",5]], pl:[{name:"EXE:5000 High-NA EUV",desc:"0.55 NA · 2nm+ lithography · shipping to TSMC/Intel/Samsung",pos:"Monopoly next-gen"},{name:"NXE:3800E Low-NA EUV",desc:"Workhorse N3/N4 litho · ramping units",pos:"Flagship volume"},{name:"TWINSCAN NXT DUV",desc:"ArF immersion · Korea/China demand",pos:"Installed base"},{name:"HMI e-beam metrology",desc:"Multi-beam mask inspection · yield enablement",pos:"Growth segment"},{name:"YieldStar",desc:"Overlay + CD metrology · recurring software",pos:"Adjacency"}], cp:["Canon (DUV only)","Nikon (DUV only)","SMEE (Shanghai · domestic alt)"], ops:{hq:"Veldhoven, Netherlands",fd:1984,emp:44000,mfg:["Veldhoven NL","Wilton CT (dev)","Hsinchu/Linkou (service)"],ne:"Late Apr 2026"}, own:{insider:.1,institutional:80} },
  { t:"AMAT", themes:["ai"], cc:"🇺🇸", nm:"Applied Materials", v:"compute", s:"Foundry", r:27000, g:47, mc:140000, pe:22, pr:"Deposition, etch, ion implant, CMP equipment", d:"Largest US semiconductor equipment maker. Broad deposition/etch/CMP portfolio. Beneficiary of advanced packaging (HBM) growth. GAA/backside-power node transition.", ri:["China exposure","Cyclical equipment spending"], ca:["HBM capex","Advanced packaging","Applied Global Services growth"], dc:{f:7500,gr:10,w:9,tg:2,sh:810}, ms:{ta:.7,ch:.8,ai:.9,ra:.4}, fin:{beta:1.4,eps:8.80,div:1.64,rg:[6,12,15,12,12]}, rs:[["Semiconductor Systems",70],["Applied Global Services",25],["Display & Other",5]], geo:[["China",40],["Taiwan",17],["Korea",14],["US",12],["Japan",9],["Europe/SEA",8]], tc:[["TSMC",20],["Samsung Foundry",15],["Intel",10],["SK Hynix + Micron",14],["Chinese foundries (SMIC/CXMT/YMTC)",25],["Other",16]], pl:[{name:"Sym3 Y Etch (Selectra)",desc:"Gate-all-around selective etch · critical for N2/18A",pos:"Share leader"},{name:"Endura PVD (IMP)",desc:"Advanced copper interconnect · backside power enabling",pos:"Franchise"},{name:"Producer CVD",desc:"Dielectric + metal deposition · gapfill specialization",pos:"Category leader"},{name:"AGS (services)",desc:"200mm + legacy fab service · rapidly growing recurring",pos:"Multi-year growth"},{name:"Maydan Technology Center",desc:"Integrated R&D · co-optimization with customers",pos:"Strategic moat"}], cp:["LRCX","KLAC","TEL (Japan)","Kokusai","ASM Intl"], ops:{hq:"Santa Clara, CA",fd:1967,emp:35800,ne:"Mid May 2026"}, own:{insider:.1,institutional:80} },
  { t:"LRCX", themes:["ai"], cc:"🇺🇸", nm:"Lam Research", v:"compute", s:"Foundry", r:17000, g:48, mc:115000, pe:25, pr:"Etch & deposition for memory + logic", d:"Etch and deposition leader. ~50% memory exposure — huge HBM tailwind. Atomic-layer deposition key for advanced nodes. Clear AI capex beneficiary.", ri:["Memory cyclicality","China exposure"], ca:["HBM demand","Advanced DRAM capex"], dc:{f:4500,gr:10,w:9,tg:2,sh:130}, ms:{ta:.7,ch:.85,ai:.95,ra:.4}, fin:{beta:1.5,eps:35.00,div:9.00,rg:[5,12,18,15,14]}, rs:[["Systems",70],["Customer Support Business Group (CSBG)",30]], geo:[["China",32],["Korea",24],["Taiwan",19],["Japan",7],["US",5],["Other",13]], tc:[["Samsung + SK Hynix",32],["TSMC",18],["Micron",12],["Chinese memory (CXMT/YMTC)",20],["Intel",7],["Other",11]], pl:[{name:"Akara Etch (cryo)",desc:"Cryogenic etch for 3D NAND · 400+ layer NAND enabling",pos:"3D NAND leader"},{name:"Vantex / Kiyo",desc:"Conductor etch for logic · GAA enabling",pos:"Logic leader"},{name:"Sense.i metrology-in-process",desc:"In-situ monitoring · yield-critical",pos:"Differentiator"},{name:"Altus ALD",desc:"Tungsten ALD for interconnect · advanced packaging",pos:"Growth"},{name:"CSBG (services)",desc:"200mm + installed base services",pos:"Recurring"}], cp:["AMAT","TEL (Japan)","Hitachi High-Tech","ASM Intl"], ops:{hq:"Fremont, CA",fd:1980,emp:17000,ne:"Late Apr 2026"}, own:{insider:.1,institutional:85} },
  { t:"KLAC", themes:["ai"], cc:"🇺🇸", nm:"KLA Corporation", v:"compute", s:"Foundry", r:12000, g:61, mc:120000, pe:28, pr:"Process control · Wafer + reticle inspection", d:"Quasi-monopoly on wafer inspection and metrology. Essential for advanced node yield — content per wafer rising. Highest margins in semi cap equipment.", ri:["Single-segment concentration","China exposure"], ca:["Advanced node yield","HBM inspection content"], dc:{f:3800,gr:8,w:8,tg:2,sh:132}, ms:{ta:.7,ch:.7,ai:.95,ra:.4}, fin:{beta:1.3,eps:26.00,div:6.60,rg:[8,14,18,15,13]}, rs:[["Semiconductor Process Control (systems)",78],["Services",15],["Specialty Semi + PCB/Display",7]], geo:[["Taiwan",37],["China",22],["Korea",18],["North America",10],["Japan",7],["Other",6]], tc:[["TSMC",35],["Samsung Foundry",18],["Intel Foundry",11],["Memory (SK/Samsung/MU)",18],["Chinese customers",12],["Other",6]], pl:[{name:"Voyager 1015 broadband plasma (BBP)",desc:"Optical defect inspection · industry standard for leading edge",pos:"Monopoly-like"},{name:"eSL10 electron-beam review",desc:"SEM review + classification · AI-assisted",pos:"Leader"},{name:"Gen5 overlay metrology",desc:"Pattern-on-pattern overlay · DSA compatibility",pos:"Franchise"},{name:"Services (SPTS)",desc:"Installed base service · recurring ~30% of business",pos:"Sticky"},{name:"Wafer inspection suite",desc:"Surfscan + eVolution",pos:"Category leader"}], cp:["Applied (AMAT)","Hitachi High-Tech","Onto (ONTO)","Nova","ASML (HMI)"], ops:{hq:"Milpitas, CA",fd:1997,emp:15000,ne:"Late Apr 2026"}, own:{insider:.1,institutional:93} },
  { t:"SNPS", themes:["ai"], cc:"🇺🇸", nm:"Synopsys", v:"compute", s:"EDA", r:7000, g:83, mc:95000, pe:45, pr:"EDA · IP · Ansys (simulation)", d:"Leading EDA vendor — every chip designed uses Synopsys tools. Pending Ansys acquisition (simulation + digital twin). AI-powered design automation.", ri:["Ansys integration","EDA concentration risk"], ca:["Ansys close","AI-design product ramp"], dc:{f:1800,gr:12,w:9,tg:3,sh:155}, ms:{ta:.3,ch:.5,ai:.95,ra:.3}, fin:{beta:1.1,eps:15.00,div:0,rg:[12,15,18,15,14]}, rs:[["Design Automation (EDA)",62],["Design IP",30],["Software Integrity (divested to Sapphire 2024)",0],["Ansys (post-close)",8]], geo:[["North America",48],["APAC (Taiwan/Korea/China)",35],["Europe",14],["Other",3]], tc:[["TSMC-ecosystem customers",25],["Intel",14],["Samsung",10],["Apple",8],["NVDA/AMD/Broadcom",22],["Other fabless + systems",21]], pl:[{name:"Fusion Compiler + IC Compiler",desc:"Digital P&R · industry-leading synthesis → layout flow",pos:"Flagship digital"},{name:"VCS simulation + Verdi debug",desc:"Functional verification leader · AI-powered",pos:"Verification franchise"},{name:"PrimeTime STA",desc:"Sign-off timing analysis · industry standard",pos:"Category leader"},{name:"Interface IP (USB/PCIe/HBM/Ethernet)",desc:"High-speed IP blocks · 2nm/3nm proven",pos:"Growth engine"},{name:"Synopsys.ai (AI-driven EDA)",desc:"Generative design + optimization · embedded in tools",pos:"AI push"},{name:"Ansys (pending/closed $35B acq)",desc:"Multiphysics simulation · widens TAM to system design",pos:"Strategic expansion"}], cp:["CDNS","Siemens EDA (Mentor)","Keysight","Ansys (being acquired)"], ops:{hq:"Sunnyvale, CA",fd:1986,emp:22000,ne:"Late May 2026"}, own:{insider:.2,institutional:90} },
  { t:"CDNS", themes:["ai"], cc:"🇺🇸", nm:"Cadence Design Systems", v:"compute", s:"EDA", r:4800, g:89, mc:85000, pe:55, pr:"EDA · IP · System design", d:"Second EDA duopoly player with Synopsys. Strong momentum in simulation/system design, digital-twin. JedAI Platform for AI-assisted chip design. Heavy tailwind from AI silicon boom.", ri:["Duopoly pricing scrutiny","Premium multiple"], ca:["AI chip design cycle","System design expansion"], dc:{f:1400,gr:14,w:9,tg:3,sh:275}, ms:{ta:.3,ch:.4,ai:.95,ra:.3}, fin:{beta:1.0,eps:5.80,div:0,rg:[14,18,22,18,15]}, rs:[["Custom IC + PCB Design",30],["Digital IC Design",28],["Functional Verification",25],["Design IP",12],["System Design & Analysis",5]], geo:[["Americas",45],["APAC",38],["Europe",17]], tc:[["NVDA (premier customer)",12],["Intel",10],["AMD",9],["Apple",8],["Broadcom",7],["Samsung",6],["Other",48]], pl:[{name:"Palladium Z3 emulator",desc:"Hardware-assisted verification · AI chip sign-off · $MM boxes",pos:"Emulation leader"},{name:"Innovus digital implementation",desc:"Digital P&R · competitive w/ SNPS Fusion",pos:"Flagship digital"},{name:"Virtuoso custom IC",desc:"Analog/mixed-signal layout · ADI/TXN anchor",pos:"Custom IC #1"},{name:"JasperGold formal verification",desc:"Safety-critical verification · autos/AI",pos:"Niche premium"},{name:"Cerebrus AI-assisted",desc:"AI-driven place-and-route optimization",pos:"AI push"},{name:"Allegro PCB + Optimality",desc:"PCB design · system-level co-design",pos:"Systems"}], cp:["SNPS","Siemens EDA","Keysight","Ansys"], ops:{hq:"San Jose, CA",fd:1988,emp:13000,ne:"Late Apr 2026"}, own:{insider:.2,institutional:93} },

  /* DEFENSE · EUROPEAN + ISRAELI */
  { t:"RNMBY", themes:["defense"], cc:"🇩🇪", nm:"Rheinmetall (ADR)", v:"primes", s:"Land", r:12000, g:22, mc:75000, pe:40, pr:"Tanks (Leopard 2) · Ammunition · Air defense · Munitions scaling", d:"European rearmament epicenter. Largest ammunition producer in Europe. 2025 sales up ~323%. Forecast 2026 sales growth 40-45%. Multi-billion EU munitions backlog.", ri:["European demand cycle","Capacity expansion execution"], ca:["New ammo plants","Leopard 2 restart","Air defense wins"], dc:{f:2500,gr:45,w:10,tg:3,sh:430}, ms:{bg:.95,cf:.95,ex:.9,ra:.4}, fin:{beta:1.3,eps:18.00,div:8.10,rg:[30,50,60,45,40]}, rs:[["Vehicle Systems (Leopard 2 / tracked)",40],["Electronic Solutions (missiles/air defense)",28],["Weapon and Ammunition",22],["Other",10]], geo:[["Germany",38],["Europe ex-DE",34],["Ukraine support",15],["MENA + APAC",13]], tc:[["German Bundeswehr",30],["Ukraine (via allies)",20],["Other NATO (Baltics, Poland)",24],["Hungary",8],["Australia",6],["Other",12]], pl:[{name:"Leopard 2 MBT",desc:"Main battle tank · record orders · Ukraine visibility",pos:"Category leader"},{name:"Panther KF51 (next-gen)",desc:"Next-gen MBT · Italy adopted 2025",pos:"Future MBT"},{name:"Skyranger air defense",desc:"30mm + IRIS-T SLM AD system · European MLRS/SHORAD",pos:"Explosive growth"},{name:"Lynx IFV (KF41)",desc:"Tracked IFV · Hungary/Australia buyer",pos:"Growth"},{name:"155mm ammunition",desc:"Ammo production · quadrupling capacity",pos:"Critical supplier"},{name:"F-35 fuselage production",desc:"Weißenburg · Lockheed prime relationship",pos:"Intl aerospace"}], cp:["LMT","GD","BAESY","FINMY","Nexter/KNDS"], ops:{hq:"Düsseldorf, Germany",fd:1889,emp:40000,bl:{label:"Backlog",val:52,unit:"B"},ne:"Aug 2026"}, own:{insider:10,institutional:65} },
  { t:"BAESY", themes:["defense","space","quantum"], cc:"🇬🇧", nm:"BAE Systems (ADR)", v:"primes", s:"Air", r:34000, g:12, mc:80000, pe:22, pr:"F-35 rear fuselage · Type 26 · Eurofighter · GCAP", d:"Europe's largest defense contractor. Co-partner on F-35 (every aircraft), GCAP sixth-gen fighter, Type 26 frigates. Substantial US revenue (~45%). Broad portfolio.", ri:["GCAP program risk","Integration of new acquisitions"], ca:["GCAP funding","Type 26 exports","US presence growth"], dc:{f:2500,gr:8,w:9,tg:2,sh:3000}, ms:{bg:.9,cf:.85,ex:.85,ra:.4}, fin:{beta:.7,eps:1.80,div:.78,rg:[8,12,15,14,12]}, rs:[["Electronic Systems (US)",28],["Platforms & Services (UK/Australia)",32],["Air (Eurofighter/Tempest)",22],["Maritime",18]], geo:[["UK",39],["US",29],["Saudi Arabia",14],["Australia",12],["Other",6]], tc:[["UK MOD",40],["US DoD (via BAE Systems Inc.)",28],["Saudi Arabia",14],["Australia",8],["Other NATO",10]], pl:[{name:"Eurofighter Typhoon (33%)",desc:"4.5-gen fighter · major UK/GE/IT/SP export",pos:"Franchise"},{name:"GCAP / Tempest (6th-gen)",desc:"UK/Italy/Japan 6-gen fighter program",pos:"Future flagship"},{name:"Type 26 frigates",desc:"UK/AU/CA anti-sub frigate",pos:"Naval anchor"},{name:"Hawk trainer",desc:"Advanced jet trainer · FMS",pos:"Legacy"},{name:"M777 + Bradley",desc:"Artillery + IFV via BAE Inc.",pos:"Land systems"},{name:"RCV-Medium (US Army)",desc:"Robotic Combat Vehicle · development",pos:"Growth"}], cp:["LMT","NOC","RTX","RNMBY","FINMY","DASSY"], ops:{hq:"London, UK",fd:1999,emp:107000,bl:{label:"Backlog",val:95,unit:"B"},ne:"Aug 2026"}, own:{insider:.5,institutional:70} },
  { t:"FINMY", themes:["defense"], cc:"🇮🇹", nm:"Leonardo (ADR)", v:"electronics", s:"C4ISR", r:20000, g:10, mc:28000, pe:22, pr:"AW helicopters · Electronics (Michelangelo Dome) · GCAP · Eurofighter", d:"Italian aerospace and defense group, state-owned. Plans to double profits by 2030. Air defense (Michelangelo Dome, Iron Dome analog), helicopters, GCAP partner.", ri:["State ownership overhang","Defense cycle"], ca:["Michelangelo Dome","GCAP ramp","Helicopter export"], dc:{f:1000,gr:12,w:9,tg:2,sh:600}, ms:{bg:.9,cf:.9,ex:.7,ra:.4}, fin:{beta:1.0,eps:1.90,div:.50,rg:[8,12,18,15,12]} },
  { t:"ESLT", themes:["defense","drones"], cc:"🇮🇱", nm:"Elbit Systems", v:"electronics", s:"EW", r:6500, g:25, mc:20000, pe:28, pr:"EW · Drones · Optronics · PULS rocket artillery", d:"Israeli defense electronics leader. Combat-proven portfolio. Recent $750M PULS contract to Greece. EW, helmet-mounted systems, tactical UAVs.", ri:["Israel geopolitical exposure","Export controls"], ca:["PULS FMS growth","EW modernization contracts"], dc:{f:500,gr:15,w:10,tg:2,sh:45}, ms:{bg:.9,cf:.95,ex:.95,ra:.4}, fin:{beta:1.0,eps:10.00,div:2.20,rg:[10,15,20,18,16]} },
  { t:"MOG.A", themes:["defense","space","drones"], cc:"🇺🇸", nm:"Moog Inc", v:"electronics", s:"C4ISR", r:3500, g:28, mc:7000, pe:22, pr:"Precision motion control · Flight control · Missile guidance", d:"Precision motion control for aircraft, missiles, space. Defense ~30% of revenue. Flight control actuation, weapons guidance, military satellites.", ri:["Industrial cycle exposure","Moderate scale"], ca:["Missile guidance programs","Space actuator demand"], dc:{f:280,gr:7,w:9,tg:2,sh:32}, ms:{bg:.75,cf:.6,ex:.5,ra:.4}, fin:{beta:.9,eps:7.50,div:1.20,rg:[4,7,10,10,9]} },
  { t:"OSK", themes:["defense"], cc:"🇺🇸", nm:"Oshkosh Corp", v:"primes", s:"Land", r:10800, g:16, mc:7500, pe:13, pr:"JLTV · Tactical vehicles · Fire apparatus", d:"Medium/heavy tactical vehicles for US military (JLTV, FMTV replacement). Also fire apparatus, access equipment. Stable defense franchise.", ri:["JLTV recompete","Cyclical access equipment"], ca:["Next-gen tactical truck","JLTV export"], dc:{f:400,gr:7,w:9,tg:2,sh:65}, ms:{bg:.75,cf:.6,ex:.5,ra:.4}, fin:{beta:1.2,eps:9.00,div:1.88,rg:[4,7,10,10,9]} },

  /* NUCLEAR · UTILITIES WITH AI-DC DEALS */
  { t:"TLN", themes:["nuclear"], cc:"🇺🇸", nm:"Talen Energy", v:"utilities", s:"Merchant", r:2800, g:35, mc:22000, pe:30, pr:"Susquehanna nuclear · PJM gas · AWS PPA", d:"Independent power producer with 2.2GW Susquehanna nuclear. Signed 1,920 MW expanded PPA with AWS through 2042. Cornerstone gas acquisition adds baseload. Central to Amazon's AI power thesis.", ri:["Merchant power volatility","PJM capacity pricing"], ca:["AWS PPA full ramp","Cornerstone closing","Further hyperscaler deals"], dc:{f:900,gr:15,w:8,tg:2,sh:46}, ms:{pp:.95,pl:.7,ur:.5,ai:.98}, fin:{beta:1.2,eps:13.00,div:0,rg:[25,50,75,70,40]}, rs:[["Susquehanna Nuclear",55],["Lower Mt Bethel Gas",15],["Montour",10],["Raven/Sapphire",10],["ERCOT gas (legacy)",5],["Other",5]], geo:[["PJM (PA/NJ)",85],["ERCOT (TX)",15]], tc:[["Amazon Web Services",45],["PJM wholesale market",40],["Retail/industrial",15]], pl:[{name:"Susquehanna",desc:"2.475 GW BWR nuclear · 2 units · Salem Twp PA · 90%+ capacity factor",pos:"Tier-1 asset"},{name:"AWS PPA",desc:"17-yr 1,920 MW front-of-meter deal · $18B · through 2042",pos:"Cornerstone contract"},{name:"Montour",desc:"1,540 MW coal converted to gas · PJM",pos:"Reliability"},{name:"Lower Mt Bethel",desc:"570 MW gas peaker · PA",pos:"Peaker"},{name:"Raven/Sapphire",desc:"Cornerstone dispatchable gas acquisition (2026)",pos:"Expansion"}], cp:["CEG","VST","NRG","D","EXC","PCG"], ops:{hq:"Houston, TX",fd:2015,emp:1000,ne:"May 2026"}, own:{insider:1,institutional:92} },
  { t:"NEE", themes:["nuclear"], cc:"🇺🇸", nm:"NextEra Energy", v:"utilities", s:"Regulated", r:27000, g:50, mc:155000, pe:20, pr:"FPL regulated · Nuclear + renewables · 25-yr Google PPA", d:"Largest renewable utility + FL regulated (FPL). 25-year PPA with Alphabet for 3 GW from redeveloped nuclear. Seabrook and Point Beach reactors. Largest wind/solar operator.", ri:["Rate case outcomes","Renewable PTC exposure"], ca:["Google PPA execution","Nuclear restart decisions","Solar+storage capacity"], dc:{f:4500,gr:6,w:8,tg:2,sh:2060}, ms:{pp:.7,pl:.85,ur:.4,ai:.9}, fin:{beta:.5,eps:3.50,div:2.08,rg:[4,7,9,9,9]}, rs:[["FPL (regulated Florida)",62],["NextEra Energy Resources (contracted + merchant)",35],["Gulf Power (absorbed)",3]], geo:[["Florida",60],["Texas",14],["Rest of US",26]], tc:[["Retail residential (FPL)",40],["Commercial/industrial (FPL)",22],["Wholesale C&I offtake",25],["Hyperscalers direct PPAs",13]], pl:[{name:"Point Beach + Seabrook Nuclear",desc:"Owned nuclear · ~3 GW · SLR extensions",pos:"Baseload"},{name:"FPL Turkey Point/St Lucie",desc:"Regulated FL nuclear · SLR",pos:"Florida anchor"},{name:"Wind + Solar",desc:"Largest US renewables operator · 30+ GW installed",pos:"Category leader"},{name:"Energy Storage",desc:"Fast-growing BESS · ~3 GW pipeline",pos:"Growth"},{name:"Duane Arnold restart (proposed)",desc:"Iowa reactor restart option · AI power",pos:"Optionality"}], cp:["D","SO","EXC","CEG","DUK"], ops:{hq:"Juno Beach, FL",fd:1984,emp:17000,ne:"Late Apr 2026"}, own:{insider:.1,institutional:79} },
  { t:"EXC", themes:["nuclear"], cc:"🇺🇸", nm:"Exelon Corp", v:"utilities", s:"Regulated", r:22500, g:30, mc:44000, pe:18, pr:"ComEd · PECO · BGE · T&D utilities", d:"T&D-only utility post-Constellation spin. Serves IL / MD / NJ / PA / DC. Direct beneficiary of datacenter load growth in ComEd and PECO territories.", ri:["Regulated rate cases","Capex intensity"], ca:["DC load growth","Transmission capex cycle"], dc:{f:2200,gr:6,w:8,tg:2,sh:1010}, ms:{pp:.4,pl:.75,ur:.3,ai:.85}, fin:{beta:.5,eps:2.50,div:1.60,rg:[3,5,6,6,7]}, rs:[["ComEd (Illinois)",35],["PECO + BGE + PHI",38],["Atlantic City Electric + Pepco",15],["Delmarva",12]], geo:[["Illinois",38],["Mid-Atlantic",62]], tc:[["Residential",55],["Commercial",28],["Industrial",12],["Wholesale/Other",5]], pl:[{name:"Transmission & Distribution",desc:"Pure-play T&D utility post-CEG spin",pos:"Regulated"},{name:"ComEd (Illinois)",desc:"Chicago metro · AI DC demand growth",pos:"Core"},{name:"PECO (Philadelphia)",desc:"PA utility",pos:"Core"},{name:"BGE (Baltimore)",desc:"MD utility · DC-alley adjacent",pos:"AI-ready"},{name:"Grid modernization (ARP)",desc:"$34B+ 2025-29 capex plan",pos:"Rate base growth"}], cp:["D","NEE","SO","DUK","AEP"], ops:{hq:"Chicago, IL",fd:2022,emp:18000,ne:"Early May 2026"}, own:{insider:.1,institutional:87} },
  { t:"PEG", themes:["nuclear"], cc:"🇺🇸", nm:"Public Service Enterprise", v:"utilities", s:"Regulated", r:10500, g:30, mc:45000, pe:20, pr:"PSE&G (NJ) · Salem/Hope Creek nuclear · Transmission", d:"NJ regulated utility with 3.7 GW nuclear fleet (Salem/Hope Creek). Currently in active discussions with hyperscalers. Transmission backbone expansion.", ri:["NJ rate case risk","Nuclear cost-share partner"], ca:["Hyperscaler PPA discussions","Transmission buildout"], dc:{f:1500,gr:5,w:8,tg:2,sh:500}, ms:{pp:.6,pl:.8,ur:.45,ai:.85}, fin:{beta:.4,eps:3.90,div:2.46,rg:[3,5,6,7,7]} },
  { t:"XEL", themes:["nuclear"], cc:"🇺🇸", nm:"Xcel Energy", v:"utilities", s:"Regulated", r:15000, g:30, mc:45000, pe:19, pr:"MN / CO / WI utilities · Monticello + Prairie Island nuclear", d:"Upper Midwest utility with 1.6 GW nuclear. Wind-heavy renewable ramp + nuclear dependability. Datacenter growth in MN and CO.", ri:["Wildfire liability (CO)","Rate case execution"], ca:["CO/MN DC load","Nuclear license renewals"], dc:{f:1700,gr:6,w:8,tg:2,sh:570}, ms:{pp:.5,pl:.75,ur:.4,ai:.8}, fin:{beta:.5,eps:3.70,div:2.24,rg:[3,5,6,7,7]} },

  /* SPACE · REVENUE-GENERATING NAMES */
  { t:"LUNR", themes:["space"], cc:"🇺🇸", nm:"Intuitive Machines", v:"ground", s:"Prime", r:210, g:12, mc:2800, pe:null, pr:"IM lunar landers · Near Space Network · LTV contender", d:"First US moon landing since Apollo. Lanteris Space acquisition made it vertically integrated. 2026 guidance $900M-$1B revenue, $943M backlog, positive adj EBITDA. NASA's $4.8B Near Space Network through 2034.", ri:["Project-based revenue lumpiness","Lunar mission risk"], ca:["LTV contract (~$4.6B)","CLPS cadence","NSN recurring revenue"], dc:{f:40,gr:350,w:11,tg:3,sh:135}, ms:{do:.9,lc:.5,cm:.5,ra:.5}, fin:{beta:2.5,eps:.20,div:0,rg:[50,200,400,300,150]}, rs:[["Lunar Access Services",60],["OPG (Orbital Services)",25],["LTV / Earth Re-entry",15]], geo:[["US (NASA/DoD primary)",95],["International partners (ESA)",5]], tc:[["NASA CLPS",68],["US DoD",15],["Commercial payloads",10],["International (ESA/Telespazio)",7]], pl:[{name:"Nova-C lander",desc:"IM-1 · IM-2 · IM-3 commercial lunar landers",pos:"First US since 1972"},{name:"Nova-D lander",desc:"Larger class · IM-4/IM-5 · $180.4M task order",pos:"Production"},{name:"LTV",desc:"Lunar Terrain Vehicle · astronaut rover · NASA competition",pos:"Shortlisted"},{name:"Space Data Network",desc:"Cislunar relay satellites · Telespazio MoU",pos:"Recurring SaaS"},{name:"Khon-1 micro-rover",desc:"Small-class rover demos",pos:"Tech demo"}], cp:["RKLB","RDW","Astrobotic (pvt)","Firefly (pvt)","Blue Origin (pvt)"], ops:{hq:"Houston, TX",fd:2013,emp:600,bl:{label:"Backlog",val:943,unit:"M"},ne:"May 2026"}, own:{insider:35,institutional:45} },
  { t:"RDW", themes:["space"], cc:"🇺🇸", nm:"Redwire Corp", v:"components", s:"Structures", r:550, g:8, mc:2500, pe:null, pr:"ROSA solar · In-space mfg · Edge Autonomy drones", d:"Space infrastructure + recent Edge Autonomy acquisition (drones). ROSA solar arrays power ISS and Psyche. In-space bioprinting with Eli Lilly. Belgium defense satellite contract.", ri:["Heavy losses (-67% margin)","Acquisition integration"], ca:["Edge Autonomy synergies","NATO space procurement","In-space mfg commercialization"], dc:{f:-200,gr:60,w:15,tg:3,sh:140}, ms:{do:.75,lc:.3,cm:.7,ra:.5}, fin:{beta:2.3,eps:-1.90,div:0,rg:[10,30,60,80,60]} },
  { t:"FLY", themes:["space"], cc:"🇺🇸", nm:"Firefly Aerospace", v:"launch", s:"Small-lift", r:150, g:null, mc:7500, pe:null, pr:"Alpha launch · Blue Ghost lunar lander · MLV medium lift", d:"Successful small-lift Alpha rocket + Blue Ghost Moon lander (first fully successful private lunar landing). MLV (medium lift) in development. IPO'd 2025.", ri:["Vulcan booster supplier issues","MLV development"], ca:["Blue Ghost cadence","MLV maiden launch","Alpha reliability"], dc:{f:-80,gr:200,w:15,tg:3,sh:190}, ms:{do:.85,lc:.8,cm:.5,ra:.5}, fin:{beta:2.6,eps:-1.20,div:0,rg:[100,200,300,400,300]} },
  { t:"VOYG", themes:["space"], cc:"🇺🇸", nm:"Voyager Technologies", v:"ground", s:"Prime", r:140, g:15, mc:1800, pe:null, pr:"Starlab space station · Defense engineering", d:"Parent of Starlab (commercial ISS successor). Completed Critical Design Review with NASA. Defense engineering business funds the long-runway station build.", ri:["Station deployment timeline","Customer pipeline uncertainty"], ca:["Starlab CDR milestones","Defense engineering backlog"], dc:{f:-30,gr:30,w:14,tg:3,sh:55}, ms:{do:.85,lc:.2,cm:.6,ra:.5}, fin:{beta:2.0,eps:-.70,div:0,rg:[15,25,35,40,40]} },
  { t:"TDY", themes:["space","defense","drones"], cc:"🇺🇸", nm:"Teledyne Technologies", v:"electronics", s:"Sensors", r:5670, g:42, mc:24000, pe:28, pr:"Rad-hard IR sensors · FLIR · e2v imaging · Space semiconductors", d:"Advanced imaging and sensor solutions spanning defense, space, industrial, and medical. Tranche 3 SDA sensor contract winner. e2v = radiation-hardened CMOS image sensors (Earth observation, star trackers). Teledyne e2v makes rad-hard microprocessors (LEON, PowerPC) used throughout space industry. FLIR thermal imaging across domains.", ri:["DoD budget risk","Commercial aerospace cycle","FLIR competitive pressure"], ca:["SDA Tranche 3 sensor ramp","Commercial space sensor demand","Missile warning satellite wins"], dc:{f:680,gr:6,w:9,tg:2,sh:47}, ms:{do:.9,lc:.6,cm:.6,ra:.5}, fin:{beta:.9,eps:17.50,div:0,rg:[8,10,8,7,9]}, rs:[["Digital Imaging (incl. FLIR + e2v)",56],["Instrumentation",22],["Aerospace & Defense Electronics",14],["Engineered Systems",8]], geo:[["US",64],["Europe",22],["Asia",10],["Other",4]], tc:[["US DoD (direct + prime)",28],["NASA / ESA / JAXA",7],["Commercial aerospace",18],["Scientific / academic",14],["Industrial/medical",33]], pl:[{name:"Space Imaging (e2v)",desc:"Rad-hardened CMOS + CCD imagers · Ruby USV · Emerald Gen2 · star trackers · EO payloads",pos:"Category leader"},{name:"Tranche 3 IR Focal Planes",desc:"SDA missile tracking satellites · multi-award · multi-megapixel rad-hard detectors",pos:"Flagship space program"},{name:"FLIR Thermal Imaging",desc:"Acquired 2021 · thermal cameras · defense + drones + commercial",pos:"Franchise"},{name:"Rad-hard microprocessors",desc:"LEON + PowerPC space-qualified · constellation flight computers",pos:"Specialty moat"},{name:"Optical Mass Spectrometers",desc:"Scientific + defense instrumentation",pos:"Diversifier"}], cp:["Raytheon (RTX)","L3Harris (LHX)","BAE Systems","Leonardo DRS","Elbit"], ops:{hq:"Thousand Oaks, CA",fd:1960,emp:14100,mfg:["Goleta CA","Chelmsford UK","Grenoble FR","Billerica MA"],ne:"Late Apr 2026"}, own:{insider:.4,institutional:92} },
  { t:"KRMN", themes:["space","defense"], cc:"🇺🇸", nm:"Karman Space & Defense", v:"components", s:"Structures", r:470, g:36, mc:5500, pe:null, pr:"Payload fairings · Interstages · Solid rocket motors · Pressure vessels", d:"Pure-play space + missile defense systems provider. IPO'd Feb 2025 at $22/share, now $49+ following secondary. 50-year heritage across 100+ defense/space programs. Three segments: Payload Protection (fairings, heat shields), Aerodynamic Interstage (composite stage adapters), and Propulsion Systems (solid rocket motors). SpaceX, ULA, Lockheed, Raytheon customers. 36% revenue growth 2025.", ri:["Customer concentration","Defense budget cycle","Backlog conversion pace"], ca:["Hypersonic program ramp (Dark Eagle, LRHW)","SDA Tranche 2/3 fairings","Backlog $801M (+70% YoY)","Missile defense surge"], dc:{f:70,gr:32,w:12,tg:3,sh:113}, ms:{do:.95,lc:.85,cm:.7,ra:.5}, fin:{beta:1.4,eps:.15,div:0,rg:[25,30,37,35,30]}, rs:[["Payload & Protection Systems",44],["Aerodynamic Interstage Systems",28],["Propulsion & Launch Systems",28]], geo:[["US",94],["Europe",4],["Other",2]], tc:[["Lockheed Martin",24],["Raytheon (RTX)",18],["Northrop Grumman",14],["SpaceX",10],["ULA (Boeing+LMT JV)",8],["US DoD direct",18],["Other",8]], pl:[{name:"Payload Fairings",desc:"Composite fairings for launch vehicles · protects satellites during ascent · Falcon · Atlas V",pos:"Category franchise"},{name:"Interstage Systems",desc:"Composite stage adapters · Vulcan, Antares, missile defense interceptors",pos:"Sole-source on key programs"},{name:"Solid Rocket Motors",desc:"Tactical + strategic solid motors · hypersonic boosters · missile defense",pos:"Specialty"},{name:"Composite Pressure Vessels",desc:"Propellant tanks · breathing systems · aerospace fluid",pos:"Diversifier"},{name:"Hypersonic Components",desc:"Dark Eagle LRHW boost glide + heat shields · LGM-35A Sentinel",pos:"Fast-growth anchor"}], cp:["Aerojet (L3H)","Northrop Grumman","Moog","TransDigm","AJRD"], ops:{hq:"Huntington Beach, CA",fd:1976,emp:850,bl:{label:"Backlog",val:801,unit:"M"},ne:"May 2026"}, own:{insider:65,institutional:25} },
  { t:"PH", themes:["space","defense"], cc:"🇺🇸", nm:"Parker Hannifin", v:"components", s:"Actuators", r:19900, g:27, mc:84000, pe:23, pr:"Aerospace hydraulics · Flight controls · Fuel systems · Meggitt acquisition", d:"Industrial + aerospace motion/control systems giant. Aerospace Systems segment = ~30% of revenue, +14% YoY with A320/MAX + defense ramp. 2022 Meggitt acquisition added combat aircraft composites + sensors. Fluid conveyance, flight control actuators, pneumatics, fuel systems. F-35, F-16, F-18 content. Commercial space launch supplier.", ri:["Industrial cycle","Aerospace OEM delivery pace","Debt from Meggitt acquisition"], ca:["F-35 build-rate increase","Commercial aftermarket cycle","FY26 organic aerospace +11% guide"], dc:{f:3200,gr:6,w:8,tg:2,sh:128}, ms:{do:.7,lc:.5,cm:.7,ra:.5}, fin:{beta:1.4,eps:28.50,div:7.40,rg:[18,14,10,8,7]}, rs:[["Diversified Industrial (North America + International)",68],["Aerospace Systems",32]], geo:[["North America",56],["Europe",24],["Asia-Pacific",16],["Latin America",4]], tc:[["Boeing",10],["Airbus",9],["US DoD (direct + tier)",14],["Commercial aerospace aftermarket",18],["Industrial OEMs",40],["Other",9]], pl:[{name:"Flight Control Actuators",desc:"Primary + secondary flight controls · F-35, F-18, 737 MAX, A320neo",pos:"Platform content"},{name:"Hydraulic Systems (aerospace)",desc:"Hydraulic power generation + distribution · commercial + military",pos:"Franchise"},{name:"Fuel Systems (Meggitt)",desc:"Acquired 2022 · combat aircraft fuel · engine controls",pos:"Strategic expansion"},{name:"Sensors + Composites (Meggitt)",desc:"Engine sensors · aerothermal + composite brakes",pos:"High-margin"},{name:"Gas Turbine Engines (Kaman Aerospace subset)",desc:"Small turbines · APUs · UAV engines",pos:"Specialty"},{name:"Space launch components",desc:"Falcon + Vulcan fluid conveyance · cryogenic valves",pos:"Emerging vertical"}], cp:["Eaton","Honeywell","Emerson","Curtiss-Wright","Moog"], ops:{hq:"Cleveland, OH",fd:1917,emp:63000,mfg:["Cleveland OH","Ravenna OH","Coventry UK","Annecy FR","Wichita KS"],ne:"Early May 2026"}, own:{insider:.3,institutional:87} },
  { t:"THLLY", themes:["space","defense"], cc:"🇫🇷", nm:"Thales SA (ADR)", v:"ground", s:"Prime", r:23500, g:15, mc:62000, pe:28, pr:"Thales Alenia Space · SYRACUSE satellites · Ground Master radars · Identity/cyber", d:"French defense/space/cyber prime. Thales Alenia Space (67%, Leonardo 33%) is Europe's largest satellite builder — Pleiades, SYRACUSE military comms, Galileo GNSS. Strong radar franchise (Ground Master). Major cybersecurity unit. Benefiting from European defense ramp and FCAS (Future Combat Air System) partnership.", ri:["European defense cycle","Space satellite competition","State ownership overhang"], ca:["European rearmament","FCAS program","Galileo 2nd gen","SYRACUSE IV military satcom"], dc:{f:1800,gr:13,w:8,tg:2,sh:210}, ms:{do:.85,lc:.6,cm:.7,ra:.5}, fin:{beta:1.0,eps:10.80,div:3.60,rg:[8,12,14,15,13]} },
  { t:"RYCEY", themes:["space","defense","nuclear"], cc:"🇬🇧", nm:"Rolls-Royce Holdings (ADR)", v:"components", s:"Propulsion", r:22000, g:20, mc:95000, pe:38, pr:"Trent engines · Pearl (bizjet) · Eurofighter EJ200 · F-35 LiftFan · SMR nuclear", d:"UK aerospace engine major. Civil aerospace (Trent widebody engines for 787/A350/777X), defense (EJ200 for Eurofighter, F-35B vertical lift system, RAF Typhoon/Rafale), power systems (industrial/marine), and SMR nuclear unit (UK Gen IV reactor program, £2B+ government support). Rolls-Royce Electrical for urban air mobility. Turnaround success under Erginbilgic.", ri:["Wide-body cycle","SMR execution risk","Component supply chain"], ca:["Trent aftermarket cycle","Pearl business jet ramp","UK SMR selection","F-35B LiftFan production"], dc:{f:3500,gr:12,w:8,tg:2,sh:8400}, ms:{do:.75,lc:.5,cm:.8,ra:.5}, fin:{beta:1.6,eps:.30,div:.06,rg:[10,15,22,18,14]} },
  { t:"CAE", themes:["space","defense"], cc:"🇨🇦", nm:"CAE Inc.", v:"ground", s:"Subsystems", r:3400, g:32, mc:11500, pe:30, pr:"Flight simulators · Pilot training · Defense mission systems · Space crew training", d:"Global leader in flight simulation, modeling and training for civil aviation, defense, and security. Trained NASA astronauts on Space Shuttle; provides simulators and training for satellite operations, spacecraft mission ops. Defense business divested half in 2023 (sold to Textron partner). Civil aviation pilot shortage supercycle driver.", ri:["Commercial aviation cycle","Defense program lumpiness"], ca:["Pilot training shortage","Defense bounce","Commercial aerospace recovery"], dc:{f:180,gr:10,w:9,tg:2,sh:318}, ms:{do:.6,lc:.3,cm:.8,ra:.5}, fin:{beta:1.1,eps:.90,div:0,rg:[8,12,15,12,10]} },
  { t:"MHVYF", themes:["space","defense","nuclear"], cc:"🇯🇵", nm:"Mitsubishi Heavy Industries (ADR)", v:"components", s:"Propulsion", r:43000, g:17, mc:85000, pe:32, pr:"H3 rocket · F-X (GCAP) · Type-10 tank · Nuclear reactors · Aero components", d:"Japanese industrial conglomerate. Aerospace unit builds H3 rocket (Japan's primary launcher, JAXA), MRJ/SpaceJet (canceled). Defense: F-X next-gen fighter under GCAP (with UK/Italy), Type-10 tank, P-1 maritime patrol. Nuclear reactor unit. Boeing 787 fuselage partner. Japanese rearmament beneficiary.", ri:["H3 launch cadence","GCAP program execution","Nuclear restart pace"], ca:["H3 commercial launches ramp","Japan defense spending 2% GDP","GCAP NRE funding","SMR optionality"], dc:{f:2400,gr:13,w:9,tg:2,sh:340}, ms:{do:.85,lc:.7,cm:.7,ra:.5}, fin:{beta:1.0,eps:2.60,div:.60,rg:[5,10,14,15,12]} },
  { t:"ERJ", themes:["space","defense"], cc:"🇧🇷", nm:"Embraer SA (ADR)", v:"ground", s:"Prime", r:7100, g:20, mc:8000, pe:22, pr:"E-Jets E2 · KC-390 Millennium · Super Tucano · Satellite bus Amazônia", d:"World's #3 commercial aircraft OEM after Boeing/Airbus. E-Jets regional program strong (+30% deliveries). KC-390 Millennium strategic airlifter winning NATO orders (Netherlands, Austria, Portugal, Czechia). Defense & Security unit includes Amazônia satellite bus (Brazilian EO sat heritage). Joint sat ventures with Hisdesat (Spain).", ri:["Commercial aviation cycle","Brazilian macro / FX","Defense contract timing"], ca:["E-Jet E2 ramp","KC-390 NATO orders","Urban air mobility (Eve)","Brazilian space program"], dc:{f:400,gr:18,w:10,tg:2,sh:185}, ms:{do:.6,lc:.4,cm:.75,ra:.5}, fin:{beta:1.4,eps:1.90,div:0,rg:[15,22,18,20,18]} },
  { t:"HXL", themes:["space","defense"], cc:"🇺🇸", nm:"Hexcel Corporation", v:"materials", s:"Composites", r:1780, g:24, mc:5200, pe:25, pr:"Carbon fiber composites · HexPly prepregs · HexTow fibers", d:"World leader in advanced composites — carbon fiber, honeycomb, and prepreg materials for aero structures. Boeing 787 wings, Airbus A350 primary structure, F-35 airframe. Emerging space applications: launch vehicle fairings, fuel tanks, satellite structures.", ri:["Commercial aero build-rate cycle","Boeing 737 MAX dependency"], ca:["787/A350 production ramp","Space vehicle composite demand","New carbon fiber capacity"], dc:{f:180,gr:8,w:10,tg:2,sh:83}, ms:{do:.4,lc:.4,cm:.6,ra:.5}, fin:{beta:1.3,eps:1.75,div:.60,rg:[12,8,7,6,8]}, rs:[["Commercial Aerospace",61],["Space & Defense",24],["Industrial",15]], geo:[["US",48],["Europe",38],["Asia",14]], tc:[["Airbus",29],["Boeing",26],["GE Aerospace / Safran",12],["US DoD / primes (LMT, NOC)",14],["Space (SpaceX, Blue Origin, ULA)",5],["Other",14]], pl:[{name:"HexTow Carbon Fiber (IM7/IM8)",desc:"Aerospace-grade intermediate modulus · A350/787 wings",pos:"Category leader"},{name:"HexPly Prepregs",desc:"Pre-impregnated composite tape · automated fiber placement",pos:"Franchise"},{name:"HexWeb Honeycomb",desc:"Aluminum + Nomex honeycomb core · satellite structures",pos:"Space-critical"},{name:"Engineered Core",desc:"Primary structure cores · F-35 airframe",pos:"Defense anchor"},{name:"Space launch composites",desc:"Fairings + propellant tanks · Ariane 6 · SLS · Falcon",pos:"Emerging high-margin"}], cp:["Toray Industries","Teijin","Mitsubishi Chemical","Solvay","Albany Composites"], ops:{hq:"Stamford, CT",fd:1946,emp:4900,mfg:["Decatur AL (largest)","Salt Lake City UT","Kent WA","Les Avenieres FR","Duxford UK"],ne:"Late Apr 2026"}, own:{insider:.3,institutional:96} },
  { t:"HWM", themes:["space","defense","nuclear"], cc:"🇺🇸", nm:"Howmet Aerospace", v:"materials", s:"Alloys", r:7430, g:31, mc:67000, pe:58, pr:"Jet engine airfoils · Fasteners · Structural titanium · Wheel systems", d:"Leading producer of highly engineered precision metal parts for aerospace and defense. Jet engine hot-section airfoils, aerospace fasteners, titanium airframe forgings, and commercial wheel systems. Space exposure: rocket engine airfoils (BE-4, Raptor), titanium structures, launch vehicle fasteners.", ri:["Boeing/Airbus build rate cycle","Labor/raw materials inflation"], ca:["Engine spares supercycle","MAX recovery","Space engine ramp (BE-4, Raptor)","Ti-based SMR fuel tubing"], dc:{f:700,gr:14,w:9,tg:2,sh:410}, ms:{do:.4,lc:.6,cm:.9,ra:.5}, fin:{beta:1.0,eps:2.90,div:.40,rg:[8,12,15,14,12]}, rs:[["Engine Products (airfoils)",52],["Fastening Systems",22],["Engineered Structures (Ti forgings)",14],["Forged Wheels (commercial trucks)",12]], geo:[["US",56],["Europe",26],["Other",18]], tc:[["GE Aerospace",18],["Pratt & Whitney (RTX)",17],["Rolls-Royce",10],["Boeing",12],["Airbus",10],["Space (SpaceX, BE)",4],["Other",29]], pl:[{name:"Engine Airfoils",desc:"Single-crystal nickel superalloy turbine blades · GE9X, LEAP, PW1000G · Raptor/BE-4 hot section",pos:"Technology moat"},{name:"Aerospace Fasteners",desc:"Titanium + nickel alloys · Boeing 787 · A350 · F-35 · launch vehicles",pos:"Franchise"},{name:"Titanium Structures",desc:"Isothermal forged Ti-6Al-4V · airframe + space vehicle structures",pos:"Premium specialty"},{name:"Forged Wheels",desc:"Aluminum commercial truck wheels · diversifier",pos:"Cyclical"},{name:"Additive Manufacturing (Ti)",desc:"Ti powder → printed rocket engine parts · growth vector",pos:"Emerging"}], cp:["ATI","CRS","Precision Castparts (pvt-BRK)","GKN Aerospace","PCC Aerostructures"], ops:{hq:"Pittsburgh, PA",fd:2020,emp:25500,mfg:["Whitehall MI (airfoils)","Dover NJ (fasteners)","Cleveland OH","La Porte IN","Morristown TN"],ne:"Early May 2026"}, own:{insider:.2,institutional:89} },
  { t:"ATI", themes:["space","defense","nuclear"], cc:"🇺🇸", nm:"ATI Inc.", v:"materials", s:"Titanium", r:4720, g:18, mc:8400, pe:30, pr:"Titanium alloys · Nickel superalloys · Specialty steels", d:"Specialty materials producer for aerospace, defense, energy, and medical. #1 US titanium producer for airframes + engines (Ti-6Al-4V, Ti-6242). Nickel superalloys (Waspaloy, Inconel 718) for hot-section engine components. Key F-35, 787, A350, space launch supplier.", ri:["Boeing/Airbus production cycles","Raw material (Ti sponge) volatility","LATAM spatial demand lumpy"], ca:["F-35 Lot 19+","Space vehicle Ti demand","Engine spares upcycle","Mmulti-gen nickel superalloys"], dc:{f:180,gr:12,w:11,tg:2,sh:138}, ms:{do:.5,lc:.5,cm:.7,ra:.5}, fin:{beta:1.6,eps:2.05,div:0,rg:[10,15,18,12,10]}, rs:[["High Performance Materials & Components",61],["Advanced Alloys & Solutions",39]], geo:[["US",63],["Europe",22],["Asia",9],["Other",6]], tc:[["LMT (F-35)",12],["Boeing",10],["Airbus",8],["RTX Pratt",8],["GE Aerospace",7],["SpaceX + Blue Origin + ULA",4],["Industrial/medical",51]], pl:[{name:"Titanium Airframe (Ti-6Al-4V)",desc:"F-35 + 787 + A350 airframe forgings · sponge → plate",pos:"Strategic US supplier"},{name:"Nickel Superalloys",desc:"Waspaloy · Inconel 718 · Rene 41 · engine hot section",pos:"High-spec premium"},{name:"Specialty Steels",desc:"Maraging + stainless · rocket motor cases · fastener stock",pos:"Franchise"},{name:"Ti Powder (additive)",desc:"Aerospace-grade Ti powder for metal 3D printing",pos:"Growth vector"},{name:"Forged Products",desc:"Near-net-shape forgings for aero primary structures",pos:"Value-add"}], cp:["HWM","CRS","Haynes International","Precision Castparts (pvt)","VSMPO-AVISMA (Russia)"], ops:{hq:"Dallas, TX",fd:1996,emp:7900,mfg:["Albany OR","Monroe NC","Washington PA","Richburg SC"],ne:"Late Apr 2026"}, own:{insider:.5,institutional:94} },
  { t:"CRS", themes:["space","defense"], cc:"🇺🇸", nm:"Carpenter Technology", v:"materials", s:"Alloys", r:2830, g:23, mc:9500, pe:30, pr:"Specialty alloys · Engine fastener stock · Ti powder", d:"High-performance specialty alloys for aerospace/defense (~55% of revenue), medical, and industrial. Dominant in premium aerospace fastener stock, engine alloys, and Ti powder for additive manufacturing. Record demand from aerospace OEMs. Dynamet subsidiary = titanium medical/aero.", ri:["Aerospace OEM build rates","Raw materials (Ni/Ti) pricing"], ca:["FY26 guidance raised","Aerospace supercycle","Additive Ti powder ramp"], dc:{f:300,gr:28,w:9,tg:2,sh:51}, ms:{do:.6,lc:.5,cm:.6,ra:.5}, fin:{beta:1.4,eps:5.85,div:.80,rg:[40,35,25,22,18]}, rs:[["Specialty Alloys Operations (SAO)",84],["Performance Engineered Products (PEP)",16]], geo:[["US",72],["Europe",18],["Asia",8],["Other",2]], tc:[["GE Aerospace",18],["Pratt & Whitney",15],["Rolls-Royce",10],["Safran",8],["Medical device OEMs",14],["DOD primes",10],["Other",25]], pl:[{name:"Engine Alloy Billet",desc:"Waspaloy · Inconel 718 · Custom 465 · turbine components",pos:"Premium supplier"},{name:"Aerospace Fastener Stock",desc:"MP35N · Nitronic · Inconel · A286 · high-strength bolts",pos:"Category leader"},{name:"Titanium (Dynamet)",desc:"Medical + aerospace Ti wire, bar, forgings",pos:"Vertical integration"},{name:"Ti Powder (additive)",desc:"AM-grade Ti-6Al-4V · Rocket Lab + RTX customers",pos:"Growth vector"},{name:"Electron Beam Melting",desc:"Ultra-clean premium aerospace alloys",pos:"Process moat"}], cp:["HWM","ATI","Haynes","VSMPO-AVISMA","Kobe Steel"], ops:{hq:"Philadelphia, PA",fd:1889,emp:4700,mfg:["Reading PA","Washington PA","Latrobe PA"],ne:"Late Apr 2026"}, own:{insider:.5,institutional:95} },
  { t:"VSAT", themes:["space","defense"], cc:"🇺🇸", nm:"Viasat Inc.", v:"satellites", s:"Broadband", r:4580, g:31, mc:1400, pe:null, pr:"ViaSat-3 Ka-band · Inmarsat (L-band) · Defense SATCOM", d:"Satellite broadband operator + defense comms prime. Post-Inmarsat acquisition ($6.5B, 2023), now a top-3 global satcom player. ViaSat-3 constellation completing. Government + aviation + maritime focus. Losing retail consumer share to Starlink but defense/IFC anchor holds.", ri:["Starlink consumer share loss","ViaSat-3 satellite issues","Debt load post-Inmarsat"], ca:["ViaSat-3 deployment","L-band defense growth","IFC (in-flight connectivity)"], dc:{f:-500,gr:-2,w:16,tg:3,sh:130}, ms:{do:.9,lc:.3,cm:.6,ra:.7}, fin:{beta:1.6,eps:-5.20,div:0,rg:[10,15,5,-2,2]}, rs:[["Defense & Advanced Technologies",37],["Communication Services",63]], geo:[["US",56],["Europe",22],["APAC",14],["Other",8]], tc:[["US DoD",24],["Commercial airlines (IFC)",22],["Maritime",16],["Government (non-DoD)",18],["Enterprise",20]], pl:[{name:"ViaSat-3 constellation",desc:"3 Ka-band GEO satellites · first launched 2023 (antenna failure) · second launched 2025",pos:"Flagship - troubled"},{name:"Inmarsat L-band",desc:"Global L-band constellation · maritime + aviation safety services · GX Ka-band",pos:"Acquisition anchor"},{name:"IFC (In-Flight Connectivity)",desc:"American Airlines, Delta, United · 3,500+ aircraft",pos:"Category leader"},{name:"Defense SATCOM",desc:"Link-16 tactical data · mil-cert terminals · anti-jam",pos:"Franchise"},{name:"Ground Systems",desc:"Ground stations + modems · white-label",pos:"Diversifier"}], cp:["IRDM","GSAT","SATS","Starlink (SpaceX pvt)","Hughes (SATS)","Eutelsat-OneWeb"], ops:{hq:"Carlsbad, CA",fd:1986,emp:7500,ne:"May 2026"}, own:{insider:2,institutional:75} },
  { t:"SATS", themes:["space","defense"], cc:"🇺🇸", nm:"EchoStar Corporation", v:"satellites", s:"Broadband", r:15630, g:38, mc:9800, pe:null, pr:"HughesNet · Boost Mobile · DISH TV · (sold LEO spectrum to SpaceX)", d:"Satellite + wireless + pay-TV holding company. Pivotal 2025 events: sold 600 MHz + C-band spectrum to AT&T ($22.65B) and spectrum to SpaceX ($19.6B incl. $8.4B SpaceX equity stake). Now asset-light; Hughes GEO broadband + DISH satellite TV remain. Unique indirect SpaceX exposure.", ri:["Subscriber churn (DISH/HughesNet)","Strategic direction post-spectrum sale"], ca:["SpaceX stake upside","Asset-light transition","Content unit monetization"], dc:{f:100,gr:-4,w:12,tg:3,sh:283}, ms:{do:.4,lc:.4,cm:.8,ra:.6}, fin:{beta:1.4,eps:-3.40,div:0,rg:[-2,0,-3,-4,-2]}, rs:[["Pay-TV (DISH)",56],["Broadband/Wireless (Hughes + Boost)",34],["Enterprise/Other",10]], geo:[["US",92],["LatAm",6],["Other",2]], tc:[["Pay-TV subscribers",56],["Wireless (Boost postpaid)",18],["Hughes enterprise",14],["Hughes consumer broadband",12]], pl:[{name:"DISH Network (Pay-TV)",desc:"8.5M satellite TV subs · declining · cash engine",pos:"Declining franchise"},{name:"Hughes (satellite broadband)",desc:"JUPITER GEO satellites · Ka-band · enterprise focus post-Starlink",pos:"Defensive"},{name:"Boost Mobile",desc:"5G network build-out · MVNO + some owned 5G · ~7M subs",pos:"Strategic challenge"},{name:"SpaceX equity stake",desc:"$8.4B minority stake · spectrum-for-equity swap Oct 2025",pos:"Hidden value"},{name:"Jupiter 3 (Hughes)",desc:"World's largest GEO satellite · Ka-band broadband",pos:"Infrastructure"}], cp:["T","VZ","TMUS","VSAT","GSAT","IRDM"], ops:{hq:"Englewood, CO",fd:1980,emp:14000,ne:"May 2026"}, own:{insider:53,institutional:35} },
  { t:"GSAT", themes:["space"], cc:"🇺🇸", nm:"Globalstar Inc.", v:"satellites", s:"D2D", r:350, g:52, mc:3200, pe:null, pr:"MSS · IoT · Apple Emergency SOS · Amazon acquisition pending", d:"Satellite voice/data operator and IoT service provider. Exclusive partner to Apple for iPhone Emergency SOS (est. $1.7B prepaid Apple contract). April 2026: Amazon announced acquisition to expand Project Kuiper. Prior moves: Feb 2025 reverse split + Nasdaq uplisting. C-3 3rd-gen satellite system ramping.", ri:["Amazon acquisition close risk","Apple contract renewal","Starlink/Skylo competition"], ca:["Amazon (AMZN) acquisition close","C-3 satellite deployment","RM200M IoT module rollout"], dc:{f:50,gr:35,w:14,tg:3,sh:85}, ms:{do:.3,lc:.6,cm:.9,ra:.5}, fin:{beta:2.0,eps:-.30,div:0,rg:[5,18,35,25,20]}, rs:[["Service (Apple + MSS)",78],["Subscriber equipment",12],["Wholesale capacity leases",10]], geo:[["North America",72],["Europe",12],["Latin America",10],["Other",6]], tc:[["Apple (prepaid SOS)",42],["Commercial MSS",22],["IoT (asset tracking)",18],["Wholesale capacity",10],["US Army / government",8]], pl:[{name:"Apple Emergency SOS",desc:"iPhone 14+ emergency messaging · $1.7B prepaid contract · extended 2024",pos:"Flagship anchor"},{name:"C-3 Satellite System",desc:"3rd-gen LEO constellation · 17+ new satellites · SpaceX launches 2025-26",pos:"Infrastructure refresh"},{name:"RM200M IoT Module",desc:"2-way satellite IoT · launched Oct 2025 · asset tracking",pos:"Growth vector"},{name:"MSS (Mobile Satellite Services)",desc:"Voice + data for professional users · Spot tracker",pos:"Legacy franchise"},{name:"Amazon Kuiper integration",desc:"Pending acquisition to support Amazon LEO · closing 2026",pos:"Strategic exit"}], cp:["IRDM","ASTS","SATS","Starlink (SpaceX pvt)","Inmarsat (VSAT)","Skylo (pvt)"], ops:{hq:"Covington, LA",fd:1991,emp:330,ne:"May 2026"}, own:{insider:52,institutional:30} },
  { t:"WWD", themes:["space","defense"], cc:"🇺🇸", nm:"Woodward Inc.", v:"components", s:"Actuators", r:3280, g:25, mc:12000, pe:28, pr:"Aerospace fuel controls · Actuators · Industrial gas controls", d:"Aerospace + industrial precision motion/fluid control. Fuel nozzles, combustion systems, actuators for commercial and military aircraft. Natural gas engine controls. Space: SpaceX Merlin/Raptor fuel systems, Blue Origin engines.", ri:["Aerospace build cycle","Industrial gas cycle"], ca:["MAX recovery","GTF recovery","Space engine supply"], dc:{f:380,gr:8,w:8,tg:2,sh:60}, ms:{do:.5,lc:.5,cm:.7,ra:.5}, fin:{beta:1.2,eps:5.85,div:1.00,rg:[10,12,15,10,8]} },
  { t:"DCO", themes:["space","defense"], cc:"🇺🇸", nm:"Ducommun Inc.", v:"components", s:"Structures", r:790, g:18, mc:900, pe:22, pr:"Aerostructures · Electronic assemblies · Defense + commercial", d:"Provider of engineered aerospace structures + electronic assemblies. Boeing/Airbus tier-1 + F-35 + defense platforms. Growing space exposure through launch vehicle structures. Diversifying from commercial aero.", ri:["Boeing 737 MAX concentration","Commercial aero cycle"], ca:["F-35 production","Defense mix shift","Space contracts growth"], dc:{f:30,gr:6,w:10,tg:2,sh:15}, ms:{do:.7,lc:.4,cm:.5,ra:.5}, fin:{beta:1.3,eps:2.50,div:0,rg:[8,10,6,5,6]} },
  { t:"TGI", themes:["space","defense"], cc:"🇺🇸", nm:"Triumph Group", v:"components", s:"Structures", r:1190, g:22, mc:1800, pe:25, pr:"Hydraulic systems · Gearboxes · Interiors", d:"Aerospace systems supplier — hydraulic systems, gearboxes, actuation, interiors. Divested airframe systems segment 2024 to focus on systems. Boeing, Airbus, Bell, Sikorsky customer base. Restructured to profitability.", ri:["Execution on divestiture strategy","Customer concentration"], ca:["Aftermarket growth","Helicopter market","Lean transformation"], dc:{f:70,gr:5,w:12,tg:2,sh:78}, ms:{do:.6,lc:.3,cm:.5,ra:.5}, fin:{beta:1.4,eps:1.30,div:0,rg:[4,6,7,5,6]} },
  { t:"EADSY", themes:["space","defense","drones"], cc:"🇪🇺", nm:"Airbus SE (ADR)", v:"ground", s:"Prime", r:76500, g:11, mc:180000, pe:30, pr:"A320neo/A350 · Eurofighter · Ariane · CRISA + OHB space systems", d:"European aerospace prime. Commercial aircraft #1 (A320neo backlog 7,000+). Airbus Defence & Space: A400M, Eurofighter, Tiger helicopter. Major satellite builder (Pleiades Neo, CSO). Partner in Ariane Group (50% with Safran). GCAP-competitor via FCAS.", ri:["A320 ramp execution","Defense cycle","Ariane competitiveness"], ca:["A320 production ramp to 75/month","FCAS next-gen fighter","Satellite comms wins"], dc:{f:5800,gr:9,w:7,tg:2,sh:790}, ms:{do:.8,lc:.7,cm:.9,ra:.5}, fin:{beta:1.2,eps:5.40,div:2.40,rg:[10,12,14,12,10]} },
  { t:"SAFRY", themes:["space","defense"], cc:"🇫🇷", nm:"Safran SA (ADR)", v:"components", s:"Propulsion", r:30500, g:25, mc:110000, pe:35, pr:"LEAP engines · Ariane Group (50%) · Helicopter engines · Landing gear", d:"French aero/space powerhouse. CFM International (50/50 JV with GE) makes LEAP engines for A320neo/737 MAX. Ariane Group (50/50 with Airbus) builds Ariane 6. Landing gear + aircraft interiors + defense electronics. High-margin aftermarket ramping.", ri:["A320 build rate","LEAP aftermarket timing","Ariane 6 ramp"], ca:["LEAP MRO supercycle","Ariane 6 commercial launches","Electronic warfare growth"], dc:{f:3200,gr:12,w:7,tg:2,sh:420}, ms:{do:.6,lc:.7,cm:.9,ra:.5}, fin:{beta:1.1,eps:4.80,div:2.00,rg:[14,18,22,16,14]} },
  { t:"SPCE", themes:["space"], cc:"🇺🇸", nm:"Virgin Galactic Holdings", v:"launch", s:"Reusable", r:4, g:-200, mc:180, pe:null, pr:"Delta-class spaceships (next-gen) · Research + tourism", d:"Only public pure-play space tourism company. Grounded VSS Unity for Delta-class upgrades; revenue approaching zero in 2025-26. Major capital burn. Delta vehicles targeting H1 2026 flights. High-beta speculative name.", ri:["Capital burn","Delta execution risk","Sub-orbital TAM unclear"], ca:["Delta-class first flight","Scaled commercial ops 2026+"], dc:{f:-300,gr:-90,w:22,tg:3,sh:40}, ms:{do:.1,lc:.9,cm:.4,ra:.7}, fin:{beta:3.0,eps:-6.80,div:0,rg:[-50,-80,-95,-99,50]} },

  /* DRONES · SMALL PURE-PLAYS */
  { t:"DPRO", themes:["drones"], cc:"🇨🇦", nm:"Draganfly", v:"tactical", s:"Small", r:12, g:15, mc:170, pe:null, pr:"Flex FPV · Commander 3XL · ISR platforms", d:"25-year UAV maker. Flex FPV contract with US Air Force Special Ops. Commander 3XL for DoD. Palladyne AI autonomy integration. NDAA-compliant.", ri:["Micro-cap volatility","Scaling execution"], ca:["DoD procurement ramp","Canadian DND wins","Palladyne integration"], dc:{f:-20,gr:30,w:20,tg:3,sh:40}, ms:{df:.9,re:.7,cn:.7,cf:.7}, fin:{beta:2.8,eps:-.60,div:0,rg:[10,30,60,80,60]} },
  { t:"UAVS", themes:["drones"], cc:"🇺🇸", nm:"AgEagle Aerial Systems", v:"tactical", s:"Small", r:25, g:20, mc:100, pe:null, pr:"eBee TAC · MicaSense sensors · senseFly UAV", d:"Commercial + defense fixed-wing drones (eBee). MicaSense multispectral sensors. Agriculture + defense + mapping. Micro-cap with steady revenue.", ri:["Very small scale","Low margins"], ca:["DoD NDAA-compliant tactical","Agriculture retrofits"], dc:{f:-8,gr:20,w:22,tg:3,sh:20}, ms:{df:.75,re:.7,cn:.6,cf:.5}, fin:{beta:2.5,eps:-.80,div:0,rg:[-10,20,40,60,50]} },

  /* ROBOTICS · SMALL HUMANOID PROXIES */
  { t:"RR", themes:["robotics"], cc:"🇺🇸", nm:"Richtech Robotics", v:"humanoid", s:"Dexterous", r:6, g:30, mc:260, pe:null, pr:"Dex humanoid · ADAM (barista) · Matradee · Titan · Scorpion", d:"NVIDIA Jetson Thor-powered Dex humanoid (wheeled base). Operational fleet of service robots (ADAM baristas, delivery). CES 2026 showcase.", ri:["Micro-cap liquidity","Revenue concentration"], ca:["Dex pilot conversions","Manufacturing customer wins","NVIDIA GTC profile"], dc:{f:-10,gr:100,w:20,tg:3,sh:75}, ms:{la:.85,ai:.85,mfg:.6,ra:.3}, fin:{beta:3.0,eps:-.25,div:0,rg:[30,80,150,200,150]} },
  { t:"SERV", themes:["robotics"], cc:"🇺🇸", nm:"Serve Robotics", v:"logistics", s:"AMR", r:15, g:25, mc:900, pe:null, pr:"Sidewalk delivery robots · Uber + Nvidia backed", d:"Nvidia-backed sidewalk delivery robot fleet. Uber Eats partnership. 2000+ robot scaling plan. Expanding LA/DFW/Miami.", ri:["Unit economics unproven","Regulatory (sidewalk operations)"], ca:["2000-robot milestone","New city expansion","Uber volume growth"], dc:{f:-60,gr:200,w:18,tg:3,sh:55}, ms:{la:.85,ai:.9,mfg:.2,ra:.4}, fin:{beta:3.0,eps:-1.20,div:0,rg:[50,150,300,400,200]} },
  { t:"XPEV", themes:["robotics"], cc:"🇨🇳", nm:"XPeng Inc", v:"humanoid", s:"Bipedal", r:5700, g:13, mc:20000, pe:null, pr:"EVs + Iron humanoid robot · Flying car", d:"Chinese EV maker with aggressive humanoid robotics push (Iron robot). Flying car (AeroHT) division. Humanoid targeted for factory deployment late 2026.", ri:["China geopolitical","Burn rate"], ca:["Iron humanoid deployment","EV volume ramp"], dc:{f:-200,gr:30,w:14,tg:3,sh:950}, ms:{la:.8,ai:.8,mfg:.7,ra:.5}, fin:{beta:2.5,eps:-1.80,div:0,rg:[10,30,60,50,40]} },

  /* QUANTUM · NEW IPOS */
  { t:"INFQ", themes:["quantum"], cc:"🇺🇸", nm:"Infleqtion (ColdQuanta)", v:"hardware", s:"Neutral Atom", r:45, g:10, mc:1500, pe:null, pr:"Hilbert quantum (1600 qubits) · Quantum sensing · Atomic clocks", d:"First neutral-atom quantum company public (NYSE, Feb 17 2026 via SPAC). Dual-platform — sensing revenue today, computing for future. UK's first 100-qubit deployment at NQCC.", ri:["Post-SPAC drawdown","Long path to fault tolerance"], ca:["UK NQCC deployment","Sensing revenue scaling","Sqorpius 100 logical qubit roadmap"], dc:{f:-70,gr:80,w:17,tg:3,sh:120}, ms:{rd:.95,eg:.8,cl:.85,ra:.6}, fin:{beta:3.0,eps:-.90,div:0,rg:[30,80,150,150,130]}, rs:[["Pre-commercial (R&D + gov)",100]], geo:[["US",75],["UK/Europe",20],["APAC",5]], tc:[["US DoE / AFOSR",60],["UK govt (NPL)",20],["Commercial R&D",20]], pl:[{name:"Sqale neutral-atom computer",desc:"1,600+ qubit neutral-atom system · AFRL",pos:"Flagship"},{name:"Tiqker optical clocks",desc:"Ultra-precise timekeeping · GPS-alternative",pos:"Defense adjacency"},{name:"Oqtopus cold-atom",desc:"Quantum sensing for PNT",pos:"Niche"},{name:"Superstaq software",desc:"Cross-platform quantum compiler",pos:"Software layer"}], cp:["IONQ","RGTI","QBTS","QuEra (pvt)","Pasqal (pvt)"], ops:{hq:"Boulder, CO",fd:2007,emp:200,ne:"May 2026"}, own:{insider:35,institutional:15} },
  { t:"ARQQ", themes:["quantum"], cc:"🇬🇧", nm:"Arqit Quantum", v:"security", s:"PQC", r:1.5, g:60, mc:150, pe:null, pr:"Symmetric Key Agreement · Quantum-safe encryption", d:"Post-quantum cryptography pure-play. Symmetric key agreement platform. Micro-cap with modest commercial traction. Riding PQC mandate tailwinds (CNSA 2.0).", ri:["Micro-cap dilution","Pre-scale revenue"], ca:["CNSA 2.0 mandate","Defense contracts"], dc:{f:-15,gr:150,w:22,tg:3,sh:20}, ms:{rd:.7,eg:.4,cl:.8,ra:.6}, fin:{beta:3.2,eps:-.50,div:0,rg:[50,100,200,300,200]}, rs:[["Product licensing (QuantumCloud / SKA)",70],["Services",30]], geo:[["Middle East",35],["US",30],["Europe",25],["APAC",10]], tc:[["UAE govt (Virgin Orbit Arqit)",35],["Intel Community (US)",20],["Enterprise financial",25],["Telecom operators",20]], pl:[{name:"SKA Platform",desc:"Symmetric Key Agreement · PQC as-a-service",pos:"Core SaaS"},{name:"QuantumCloud",desc:"Cloud-native PQC key distribution",pos:"Flagship"},{name:"Satellite-based QKD (future)",desc:"Originally planned orbital key distribution",pos:"Paused"},{name:"NexusCybersecurity services",desc:"Advisory services · design",pos:"Services"}], cp:["LAES","PQ Solutions (pvt)","ID Quantique (pvt)"], ops:{hq:"London, UK",fd:2017,emp:90,ne:"May 2026"}, own:{insider:40,institutional:15} },
  { t:"XANM", themes:["quantum"], cc:"🇨🇦", nm:"Xanadu Quantum", v:"hardware", s:"Photonic", r:12, g:null, mc:1800, pe:null, pr:"Photonic quantum · X-series · PennyLane SDK", d:"Photonic quantum pure-play. Just IPO'd via SPAC March 2026 (Nasdaq + TSX). NVIDIA partner. Operates PennyLane open-source quantum ML library.", ri:["Fresh SPAC volatility","Photonic scaling risk"], ca:["NVIDIA partnership expansion","PennyLane adoption"], dc:{f:-60,gr:200,w:18,tg:3,sh:230}, ms:{rd:.95,eg:.8,cl:.9,ra:.6}, fin:{beta:3.2,eps:-.30,div:0,rg:[50,100,200,250,200]} },

  /* BIOTECH · GLP-1 INCUMBENTS */
  { t:"PFE", themes:["biotech"], cc:"🇺🇸", nm:"Pfizer", v:"incumbents", s:"Injectable", r:63000, g:78, mc:160000, pe:11, pr:"PF-3944 (monthly GLP-1, Metsera) · PF-3945 amylin combo · Oral ABV-002", d:"$10B Metsera acquisition re-entered Pfizer into obesity race. Monthly-dose ultra-long-acting GLP-1 Phase 2b positive. 20+ obesity trials planned 2026.", ri:["Phase 3 competitive gap vs LLY","YaoPharma collab execution"], ca:["PF-3944 Phase 3","Monthly dosing differentiation","YaoPharma orals"], dc:{f:8000,gr:5,w:8,tg:2,sh:5650}, ms:{mr:.85,ip:.85,ad:.85,ra:.4}, fin:{beta:.6,eps:3.00,div:1.72,rg:[-3,5,8,8,7]}, rs:[["Specialty Care",38],["Primary Care",40],["Oncology",15],["Hospital",7]], geo:[["US",52],["Europe",22],["Japan",5],["China",4],["ROW",17]], tc:[["Major US PBMs",35],["Cardinal/Cencora/McKesson",28],["International governments",22],["Hospital networks",15]], pl:[{name:"Comirnaty",desc:"COVID-19 vaccine · BNT162b2 · Moderna competitor",pos:"#1 COVID vaccine"},{name:"Eliquis",desc:"Apixaban · anticoagulant · BMY partnership",pos:"#1 NOAC"},{name:"Ibrance",desc:"Palbociclib · CDK4/6 · breast cancer",pos:"Off-patent 2027"},{name:"Paxlovid",desc:"Oral COVID antiviral",pos:"Declining"},{name:"Padcev",desc:"Enfortumab · bladder cancer",pos:"Growth driver"},{name:"MET-097i (Metsera)",desc:"Monthly GLP-1 · Phase 2b · $10B Nov 2025 acquisition",pos:"Obesity entry"}], cp:["LLY","MRK","ABBV","JNJ","RHHBY","NVO","BMY"], ops:{hq:"New York, NY",fd:1849,emp:81000,ne:"May 2026"}, own:{insider:.1,institutional:74} },
  { t:"RHHBY", themes:["biotech"], cc:"🇨🇭", nm:"Roche (ADR)", v:"incumbents", s:"GLP-1/GIP", r:66000, g:73, mc:280000, pe:18, pr:"CT-388 (from Carmot) · Petrelintide (Zealand) · Emugrobart muscle-sparing", d:"Re-entered obesity via $2.7B Carmot acquisition + $1.65B Zealand partnership. CT-388 GLP-1/GIP Phase 2 disappointed vs Zepbound. Multi-asset portfolio strategy.", ri:["CT-388 competitive position","Late-to-market"], ca:["Petrelintide data","Emugrobart muscle-sparing differentiation","Top-3 obesity drugmaker ambition"], dc:{f:18000,gr:7,w:8,tg:2,sh:775}, ms:{mr:.85,ip:.8,ad:.85,ra:.4}, fin:{beta:.5,eps:3.10,div:1.60,rg:[3,6,9,8,8]}, rs:[["Pharmaceuticals",77],["Diagnostics",23]], geo:[["US",46],["Europe",20],["APAC",20],["Intl ex-US ex-EU",14]], tc:[["Global payers/PBMs",70],["Hospital networks",18],["Diagnostics customers",12]], pl:[{name:"Ocrevus (MS)",desc:"Multiple sclerosis · blockbuster · subQ launch",pos:"MS leader"},{name:"Carmot obesity (CT-388)",desc:"$2.7B Carmot acq · $1.6B Zealand petrelintide deal · obesity top-3 ambition",pos:"GLP-1 entry"},{name:"Polivy",desc:"Polatuzumab (DLBCL) · fast growing",pos:"Oncology"},{name:"Vabysmo",desc:"Dual inhibitor retinal · blockbuster trajectory",pos:"Ophthalmology"},{name:"Diagnostics (Cobas)",desc:"#1 in in-vitro dx globally",pos:"Dx leader"},{name:"Xolair / Lucentis / Perjeta",desc:"Franchise biologics",pos:"Mature"}], cp:["LLY","NVO","PFE","AMGN","ABBV","JNJ"], ops:{hq:"Basel, Switzerland",fd:1896,emp:103000,ne:"Late Apr 2026"}, own:{insider:10,institutional:60} },
  { t:"AZN", themes:["biotech"], cc:"🇬🇧", nm:"AstraZeneca", v:"incumbents", s:"Oral", r:55000, g:80, mc:230000, pe:30, pr:"AZD5004 oral GLP-1 · AZD6234 amylin · Oncology + respiratory", d:"Late entrant to obesity via oral small-molecule GLP-1 (AZD5004) plus amylin agonist. Broader biopharma diversification (oncology, respiratory).", ri:["Late-stage readouts uncertain","Oral GLP-1 competitive"], ca:["AZD5004 Phase 2","Amylin combo data"], dc:{f:8500,gr:10,w:8,tg:2,sh:1550}, ms:{mr:.8,ip:.75,ad:.7,ra:.4}, fin:{beta:.6,eps:4.40,div:2.46,rg:[5,10,12,11,10]}, rs:[["Oncology",41],["BioPharma (cardio/metabolic)",32],["Rare Disease (Alexion)",19],["Respiratory + Vaccines",8]], geo:[["US",45],["Europe",18],["China",15],["Emerging",15],["Other established",7]], tc:[["Global payers/PBMs",70],["Hospital networks",22],["Specialty pharmacy",8]], pl:[{name:"Tagrisso (EGFR+ NSCLC)",desc:"Top oncology · $6B+ · ADAURA adjuvant",pos:"Category leader"},{name:"Farxiga",desc:"SGLT2i · CKD/HF expansion · $6B+",pos:"Franchise"},{name:"Enhertu (HER2 ADC)",desc:"Daiichi partnered ADC · breast cancer flagship",pos:"Ga growth"},{name:"Imfinzi",desc:"PD-L1 checkpoint · lung + bladder",pos:"Oncology"},{name:"AZD5004 (obesity)",desc:"Oral GLP-1 · Phase 2b · obesity entry",pos:"GLP-1 entry"},{name:"Alexion rare disease",desc:"Soliris + Ultomiris · complement franchise",pos:"High-margin"}], cp:["LLY","NVO","PFE","MRK","BMY","GSK"], ops:{hq:"Cambridge, UK",fd:1999,emp:90000,ne:"Late Apr 2026"}, own:{insider:.2,institutional:75} },
  { t:"ZEAL", themes:["biotech"], cc:"🇩🇰", nm:"Zealand Pharma (ADR)", v:"next_gen", s:"Amylin", r:600, g:40, mc:6500, pe:null, pr:"Petrelintide (Roche partnership) · Dapiglutide (paused) · Survodutide (BI partner)", d:"Danish peptide biotech. Petrelintide amylin monotherapy + combo with Roche CT-388. Survodutide dual agonist with Boehringer Ingelheim. Focus narrowed in Nov 2025.", ri:["Petrelintide data uncertain","Pipeline concentration"], ca:["Petrelintide Phase 3 decision","Survodutide submissions"], dc:{f:-100,gr:80,w:14,tg:3,sh:275}, ms:{mr:.5,ip:.4,ad:.85,ra:.6}, fin:{beta:1.8,eps:-2.00,div:0,rg:[20,60,120,150,100]} },
  { t:"GPCR", themes:["biotech"], cc:"🇺🇸", nm:"Structure Therapeutics", v:"next_gen", s:"Oral", r:0, g:null, mc:1800, pe:null, pr:"GSBR-209 (oral GLP-1 small molecule)", d:"Oral small-molecule GLP-1 developer. GSBR-209 differentiated from Lilly's orforglipron. Phase 2 data expected 2026. Potential takeout candidate.", ri:["Pre-revenue","Category crowding"], ca:["GSBR-209 Phase 2 readout","M&A speculation"], dc:{f:-120,gr:null,w:16,tg:3,sh:45}, ms:{mr:.3,ip:.3,ad:.8,ra:.7}, fin:{beta:2.8,eps:-2.50,div:0,rg:[0,0,0,50,200]}, rs:[["Pre-revenue (pipeline)",100]], geo:[["US (R&D)",85],["China (partnership)",15]], tc:[["NA (pre-commercial)",100]], pl:[{name:"GSBR-1290",desc:"Oral small-mol GLP-1 · Phase 2 obesity",pos:"Lead asset · oral differentiator"},{name:"ACCG-2671",desc:"Amylin receptor · Phase 1",pos:"Pipeline"},{name:"CT-996",desc:"Oral GLP-1 (from Structure China)",pos:"Pipeline"},{name:"Partnering flexibility",desc:"Key asset left open for big pharma deal",pos:"Strategic"}], cp:["VKTX","LLY (orforglipron)","PFE (Metsera)","NVO"], ops:{hq:"South San Francisco, CA",fd:2016,emp:120,ne:"May 2026"}, own:{insider:25,institutional:65} },

  /* BATTERIES · SOLID-STATE + ZINC */
  { t:"QS", themes:["batteries"], cc:"🇺🇸", nm:"QuantumScape", v:"cells", s:"Solid-state", r:0, g:null, mc:4500, pe:null, pr:"Anode-free lithium-metal · Ceramic separator · QSE-5 B-sample", d:"VW / Bill Gates-backed solid-state pure-play. Anode-free design — claimed 10-80% charge <15 min, >800 Wh/L. PowerCo deal for 40GWh (option to 80GWh).", ri:["Manufacturing scale-up","Yield/defect rate"], ca:["B-sample validation","Cobra process scaling","PowerCo ramp"], dc:{f:-280,gr:null,w:16,tg:3,sh:580}, ms:{li:.7,ev:.85,gr:.3,cn:.4}, fin:{beta:3.0,eps:-.50,div:0,rg:[0,0,0,100,300]}, rs:[["Pre-commercial (engineering billings)",100]], geo:[["US (R&D / San Jose)",80],["Germany (PowerCo JV)",20]], tc:[["Volkswagen / PowerCo JV",70],["Automotive OEM sampling",25],["Other",5]], pl:[{name:"QSE-5 (24-layer)",desc:"Solid-state Li-metal · B1 samples shipping",pos:"Flagship cell"},{name:"Cobra process",desc:"25x faster heat-treatment vs Raptor · San Jose Eagle Line",pos:"Manufacturing IP"},{name:"PowerCo JV (VW)",desc:"Licensing + JV for mass production · Europe",pos:"Core commercial path"},{name:"Eagle Line",desc:"Pilot production · inaugurated Feb 2026",pos:"Execution checkpoint"},{name:"Ducati demos",desc:"QSE-5 cells in Ducati electric motorcycle",pos:"Demonstration"}], cp:["SLDP","SES","Factorial (pvt)","Toyota (in-house)","CATL (internal)"], ops:{hq:"San Jose, CA",fd:2010,emp:1100,ne:"May 2026"}, own:{insider:3,institutional:55} },
  { t:"SLDP", themes:["batteries"], cc:"🇺🇸", nm:"Solid Power", v:"cells", s:"Solid-state", r:15, g:10, mc:600, pe:null, pr:"Sulfide solid electrolyte · BMW pilot · SK On", d:"Solid-state electrolyte materials play (arms-dealer model). BMW test vehicle powered by Solid Power cells (2025 milestone). SK On pilot line complete.", ri:["Pre-revenue at scale","Competitive QS approach"], ca:["BMW program advancement","SK On scale-up","75 metric ton electrolyte line"], dc:{f:-100,gr:null,w:18,tg:3,sh:180}, ms:{li:.7,ev:.8,gr:.2,cn:.3}, fin:{beta:2.8,eps:-.70,div:0,rg:[20,50,100,150,200]}, rs:[["License revenue (BMW/Ford)",50],["Electrolyte sample sales",35],["Government cost-share",15]], geo:[["US (R&D)",100]], tc:[["BMW (joint development)",40],["Ford (joint development)",25],["SK On (research partner)",20],["DOE",15]], pl:[{name:"All-solid-state cells (BMW)",desc:"Sulfide electrolyte solid-state cells",pos:"Flagship"},{name:"Sulfide Electrolyte Production",desc:"75 MT/yr capacity · arms dealer model",pos:"Supplier positioning"},{name:"Continuous Production Pilot",desc:"Next-gen electrolyte process · 2026",pos:"Scale-up"},{name:"SK On partnership",desc:"Pilot line electrolyte supply",pos:"Commercial bridge"}], cp:["QS","SES","Factorial (pvt)","Toyota (in-house)","CATL (internal)"], ops:{hq:"Louisville, CO",fd:2011,emp:170,ne:"May 2026"}, own:{insider:18,institutional:45} },
  { t:"EOSE", themes:["batteries"], cc:"🇺🇸", nm:"Eos Energy Enterprises", v:"integrators", s:"Utility BESS", r:80, g:-20, mc:1400, pe:null, pr:"Zinc-hybrid long-duration storage · Z3 platform", d:"Non-lithium zinc-hybrid long-duration energy storage (8-12 hr). DOE $300M loan (Cerberus-backed). Pivoting from negative margins to profitability.", ri:["Negative margins","Cerberus financing terms"], ca:["Utility contracts","DOE loan drawdown","LDES mandate wins"], dc:{f:-40,gr:150,w:15,tg:3,sh:240}, ms:{li:.1,ev:.05,gr:.95,cn:.3}, fin:{beta:2.8,eps:-.50,div:0,rg:[50,100,200,300,250]}, rs:[["Z3 zinc-hybrid battery systems",100]], geo:[["US (TX + IN mfg)",100]], tc:[["Utility BESS",52],["Industrial/C&I",28],["Microgrid/military",20]], pl:[{name:"Z3 zinc-bromide battery",desc:"Long-duration storage (4-12 hr) · iron-flow alternative",pos:"Unique chemistry"},{name:"Turtle Creek IN factory",desc:"2 GWh capacity · DOE $398M loan",pos:"Scale-up"},{name:"Cerberus Capital backing",desc:"Strategic investor + $210M commitment",pos:"Funding partner"},{name:"CAES Natural Gas Hybrid",desc:"Long-duration pilots",pos:"Emerging"}], cp:["Form Energy (pvt)","ESS (ticker)","CATL LFP","Tesla Megapack"], ops:{hq:"Edison, NJ",fd:2008,emp:230,ne:"May 2026"}, own:{insider:30,institutional:45} },
  { t:"FREY", themes:["batteries"], cc:"🇳🇴", nm:"Freyr Battery", v:"cells", s:"LFP", r:50, g:null, mc:300, pe:null, pr:"US LFP manufacturing · Coweta GA gigafactory", d:"US-based LFP cell manufacturer (relocated from Norway 2024). Georgia gigafactory in ramp. IRA manufacturing credits. Struggling for customer wins.", ri:["Customer pipeline thin","Cash runway"], ca:["US IRA tax credits","First customer wins"], dc:{f:-80,gr:null,w:22,tg:3,sh:140}, ms:{li:.8,ev:.8,gr:.5,cn:.3}, fin:{beta:3.0,eps:-1.50,div:0,rg:[-50,0,50,200,200]} },

  /* URANIUM · RARE EARTH PURE-PLAYS */
  { t:"USAR", themes:["uranium"], cc:"🇺🇸", nm:"USA Rare Earth", v:"rare_earths", s:"REE", r:0, g:null, mc:800, pe:null, pr:"Round Top REE deposit (TX) · Oklahoma magnet plant", d:"US rare earth + critical minerals developer. Round Top heavy REE deposit in Texas. Oklahoma magnet manufacturing facility. DoD funded. Recent SPAC.", ri:["Pre-revenue","Capex intensity"], ca:["Oklahoma magnet plant startup","DoD funding awards"], dc:{f:-50,gr:null,w:18,tg:3,sh:100}, ms:{up:.2,gp:.95,pl:.9,dm:.85}, fin:{beta:2.8,eps:-.80,div:0,rg:[0,0,50,150,200]} },
  { t:"NATKY", themes:["uranium"], cc:"🇰🇿", nm:"Kazatomprom (ADR)", v:"uranium", s:"Producer", r:3700, g:45, mc:10000, pe:12, pr:"World's largest uranium miner (~20% global supply)", d:"Kazakhstan state-backed uranium producer. Largest by volume globally. Low-cost ISR production. Western buyers diversifying to non-Russian supply benefits Kazatomprom.", ri:["Kazakh political risk","ISR acid supply constraints"], ca:["Western demand diversification","Long-term contract re-pricing"], dc:{f:1200,gr:10,w:10,tg:2,sh:260}, ms:{up:.98,gp:.85,pl:.7,dm:.95}, fin:{beta:1.3,eps:3.20,div:2.00,rg:[10,25,40,35,25]} },

  /* CRYPTO · AI-PIVOT MINERS (biggest gap) */
  { t:"IREN", themes:["crypto","ai"], cc:"🇦🇺", nm:"IREN Ltd (fka Iris Energy)", v:"miners", s:"AI Pivot", r:450, g:55, mc:18000, pe:null, pr:"AI compute hosting (Microsoft GB300) · BTC mining · ~3 GW pipeline", d:"Largest AI pivot story in the crypto sector. $9.7B 5-yr Microsoft deal Nov 2025 for GB300 GPU hosting. Expanding to 3 GW by 2026. +285% stock return 2025. Dual-tagged AI + crypto.", ri:["Convertible debt load","Microsoft single-customer concentration"], ca:["Microsoft deployment ramp","Prepayment drawdown","Additional hyperscaler deals"], dc:{f:80,gr:200,w:12,tg:3,sh:240}, ms:{bt:.6,rg:.5,in:.9,ra:.5,ai:.95,ta:.3,ch:.2}, fin:{beta:3.0,eps:1.50,div:0,rg:[100,200,300,250,150]}, rs:[["BTC Mining (declining)",50],["AI Cloud / GPU Hosting",42],["Power & Other",8]], geo:[["US (Texas primary)",72],["Canada (BC hydro)",23],["Australia",5]], tc:[["Microsoft (5-yr $9.7B GPU hosting)",38],["Other AI cloud tenants",18],["BTC (self-mining)",40],["Power resale",4]], pl:[{name:"Childress TX campus",desc:"2.75 GW pipeline · Microsoft 200 MW GPU cloud buildout",pos:"Flagship AI site"},{name:"Sweetwater TX",desc:"2 GW power pipeline · AI/HPC focus",pos:"Next development"},{name:"BC hydro sites",desc:"Canal Flats · Prince George · zero-carbon compute",pos:"Heritage BTC"},{name:"Horizon compute platform",desc:"Software layer for GPU cloud",pos:"Nascent"},{name:"GB300 GPU fleet",desc:"~78,000 NVIDIA Blackwell via Dell partnership",pos:"MSFT dedicated"}], cp:["CIFR","WULF","HUT","APLD","CORZ","CRWV"], ops:{hq:"Sydney, Australia",fd:2018,emp:300,bl:{label:"Committed backlog",val:13,unit:"B"},ne:"May 2026"}, own:{insider:25,institutional:55} },
  { t:"CIFR", themes:["crypto","ai"], cc:"🇺🇸", nm:"Cipher Mining", v:"miners", s:"AI Pivot", r:250, g:40, mc:6500, pe:null, pr:"AWS 15-yr lease · Fluidstack $3B · Google 5% equity", d:"Cipher's 300 MW Bear site now hosting AI workloads. 15-yr AWS lease + $3B Fluidstack deal (with Google as 5% equity partner). +218% stock 2025.", ri:["Senior secured note cost","AI tenant execution"], ca:["Bear site fill rate","Additional AI real estate wins"], dc:{f:50,gr:150,w:12,tg:3,sh:430}, ms:{bt:.6,rg:.5,in:.8,ra:.5,ai:.9,ta:.3,ch:.2}, fin:{beta:3.2,eps:.40,div:0,rg:[80,150,250,200,130]}, rs:[["BTC Mining (declining)",40],["HPC/AI Data Center Services",60]], geo:[["US (TX focus)",100]], tc:[["AWS (15-yr Black Pearl lease)",55],["Google/Fluidstack",15],["Self-mining",28],["Other",2]], pl:[{name:"Black Pearl TX (AWS)",desc:"300 MW HPC datacenter · 15-yr $5.5B AWS lease",pos:"Flagship AI asset"},{name:"Odessa TX (legacy)",desc:"~400 MW BTC mining · PPA expires 2027",pos:"Cash generator"},{name:"Stingray WA",desc:"Mining operation · divested JV stakes 2026",pos:"Winding down"},{name:"Bear JV divested",desc:"Sold 49% Alborz/Bear/Chief JVs · $40M stock",pos:"Simplification"}], cp:["IREN","WULF","MARA","RIOT","HUT","APLD"], ops:{hq:"New York, NY",fd:2020,emp:120,ne:"May 2026"}, own:{insider:35,institutional:55} },
  { t:"WULF", themes:["crypto","ai"], cc:"🇺🇸", nm:"TeraWulf", v:"miners", s:"AI Pivot", r:170, g:45, mc:4500, pe:null, pr:"Zero-carbon DCs · $9.5B Fluidstack · Google $3.2B backstop", d:"Maryland-based zero-carbon datacenter operator. $9.5B Fluidstack 168 MW TX agreement with Google $3.2B backstop. Sold Ontario gas plants Q1 2026. 3.1 GW pipeline.", ri:["Convertible debt load","Fluidstack counterparty"], ca:["Google-backed expansion","Texas buildout","AI hosting margins"], dc:{f:30,gr:130,w:13,tg:3,sh:410}, ms:{bt:.5,rg:.5,in:.85,ra:.5,ai:.9,ta:.3,ch:.2}, fin:{beta:3.3,eps:.20,div:0,rg:[50,130,220,180,120]}, rs:[["HPC/AI hosting (Fluidstack)",45],["BTC Mining (NY + PA)",50],["Other",5]], geo:[["US (NY + PA)",100]], tc:[["Fluidstack (10-yr $9.5B + Google backstop)",50],["Self-mining BTC",45],["Hosting",5]], pl:[{name:"Lake Mariner NY",desc:"500 MW zero-carbon · flagship site",pos:"Crown jewel"},{name:"Nautilus PA (JV 25%)",desc:"Cumulus Data / Talen partnership · Susquehanna nuclear power",pos:"Green mining"},{name:"Fluidstack HPC lease",desc:"168 MW dedicated to AI compute through 2035",pos:"Revenue transformation"},{name:"Construction scaling",desc:"Multiple expansion phases · $500M+ buildout",pos:"Execution risk"}], cp:["IREN","CIFR","HUT","MARA","RIOT","APLD"], ops:{hq:"Easton, MD",fd:2018,emp:100,ne:"May 2026"}, own:{insider:3,institutional:45} },
  { t:"BTDR", themes:["crypto"], cc:"🇸🇬", nm:"Bitdeer Technologies", v:"hardware", s:"ASICs", r:420, g:40, mc:3500, pe:null, pr:"SEALMINER ASICs · Self-mining · HPC pivot · 1,257 MW", d:"Vertically integrated. Designs own SEALMINER ASIC chips (Bitmain spin). Singapore-HQ. US/Norway/Bhutan sites. Sold BTC treasury to zero in Feb 2026 to fund AI buildout.", ri:["ASIC production complexity","Capex intensity"], ca:["SEALMINER gen-ups","HPC facility conversion"], dc:{f:-150,gr:100,w:14,tg:3,sh:180}, ms:{bt:.8,rg:.5,in:.5,ra:.5}, fin:{beta:3.0,eps:-.40,div:0,rg:[-20,50,150,180,100]}, rs:[["BTC self-mining",50],["ASIC sales (SEALMINER)",30],["Hosting",15],["Cloud Hash",5]], geo:[["US (TX/OH/Alabama)",55],["Bhutan",25],["Norway",15],["Other",5]], tc:[["Other BTC miners (ASIC buyers)",35],["Self-mining",50],["Hosting customers",15]], pl:[{name:"SEALMINER A1/A2",desc:"Self-designed ASICs · most-efficient 2025 claims",pos:"Chip IP"},{name:"Tydal TX (US)",desc:"570 MW mining site",pos:"US scale"},{name:"Bhutan hydro sites",desc:"Low-cost green mining in partnership w/ Druk Holding",pos:"Strategic asset"},{name:"Singapore R&D",desc:"ASIC design + software",pos:"Innovation hub"},{name:"HPC Conversion Pilots",desc:"Select sites evaluating HPC · Mississippi",pos:"Optionality"}], cp:["MARA","RIOT","IREN","CLSK","Canaan","Bitmain (pvt)"], ops:{hq:"Singapore",fd:2013,emp:900,ne:"May 2026"}, own:{insider:55,institutional:15} },

  /* ═══════════════ eVTOL (drones crossover) ═══════════════ */
  { t:"JOBY", themes:["drones"], cc:"🇺🇸", nm:"Joby Aviation", v:"evtol", s:"Air Taxi", r:30, g:null, mc:9500, pe:null, pr:"S4 eVTOL · FAA type certification · Toyota backed", d:"Leading eVTOL developer for urban air mobility. Toyota-backed ($900M+). Farthest along FAA type certification among peers. Pentagon + DOT interest for defense / dual-use missions.", ri:["FAA cert timeline","Pre-revenue scaling"], ca:["FAA type certification","Dubai commercial launch","Military dual-use"], dc:{f:-400,gr:300,w:18,tg:3,sh:810}, ms:{df:.6,re:.9,cn:.1,cf:.4}, fin:{beta:2.5,eps:-.50,div:0,rg:[0,50,200,400,400]}, rs:[["Pre-commercial (R&D + DoD)",100]], geo:[["US (FAA + DoD)",85],["UAE (launch)",10],["Japan",5]], tc:[["Toyota (investor/OEM partner)",40],["Delta Air Lines (NYC partner)",25],["DoD (Agility Prime)",20],["Dubai RTA",15]], pl:[{name:"S4 eVTOL",desc:"4-passenger + pilot · 200-mph · piloted type cert",pos:"Lead FAA applicant"},{name:"FAA Type Certification",desc:"Last eVTOL remaining · targeting 2026",pos:"Critical path"},{name:"Delta NYC/LAX network",desc:"Exclusive NYC launch partner · LGA routes",pos:"Commercial pilot"},{name:"Dubai commercial launch",desc:"First ~commercial route · 2026",pos:"Revenue catalyst"},{name:"Agility Prime",desc:"USAF/DoD dual-use contracts",pos:"Bridge revenue"}], cp:["ACHR","Vertical Aerospace (UK)","Volocopter (pvt)","Lilium (pvt)"], ops:{hq:"Santa Cruz, CA",fd:2009,emp:2000,ne:"May 2026"}, own:{insider:25,institutional:50} },
  { t:"ACHR", themes:["drones"], cc:"🇺🇸", nm:"Archer Aviation", v:"evtol", s:"Air Taxi", r:10, g:null, mc:6200, pe:null, pr:"Midnight eVTOL · Stellantis · Anduril powertrain", d:"eVTOL developer with Stellantis manufacturing partner. Signed powertrain-licensing deal with Anduril (November 2025) to power Omen autonomous UCAV — first eVTOL-to-defense tech transfer. Midnight hit 100% FAA Means-of-Compliance acceptance.", ri:["FAA cert timeline","Type inspection remaining"], ca:["Anduril Omen powertrain royalties","UAE commercial launch","Korean Air partnership"], dc:{f:-250,gr:400,w:17,tg:3,sh:630}, ms:{df:.7,re:.85,cn:.1,cf:.5}, fin:{beta:2.8,eps:-.45,div:0,rg:[0,30,150,400,500]}, rs:[["Pre-commercial (R&D)",100]], geo:[["US",80],["UAE",15],["Korea",5]], tc:[["Anduril (Omen powertrain license)",40],["Korean Air",25],["Abu Dhabi Aviation",20],["Stellantis (mfg)",15]], pl:[{name:"Midnight eVTOL",desc:"4-passenger + pilot · 100-mile range",pos:"FAA MoC 100% accepted"},{name:"Powertrain license (Anduril Omen)",desc:"First eVTOL-to-defense tech transfer · 50 drones UAE",pos:"Royalty stream"},{name:"Stellantis Partnership",desc:"Manufacturing scale · Covington GA plant",pos:"Mass mfg partner"},{name:"Korean Air exclusive",desc:"S Korea commercial deployment",pos:"Intl launch"},{name:"Abu Dhabi commercial",desc:"First commercial ops · 2026 target",pos:"Revenue catalyst"}], cp:["JOBY","Vertical Aerospace","Lilium (pvt)","Volocopter (pvt)"], ops:{hq:"Santa Clara, CA",fd:2018,emp:1000,ne:"May 2026"}, own:{insider:12,institutional:55} },

  /* ═══════════════ URANIUM INTERNATIONAL (Kazatomprom, Paladin, Boss) ═══════════════ */
  { t:"KAP", themes:["uranium"], cc:"🇰🇿", nm:"Kazatomprom", v:"uranium", s:"Producer", r:4500, g:50, mc:14000, pe:10, pr:"World's largest uranium producer · ~23% global share · Low-cost ISR", d:"World's largest uranium miner. 26 deposits across 14 assets. ~23% global market share. Cut 2026 production guidance in Q3 2025 on sulphuric acid / reagent shortages — structural supply support. Trades on LSE + AIX.", ri:["Kazakhstan jurisdictional risk","Sulphuric acid supply","Russian sanctions pass-through"], ca:["Price recovery on supply cuts","Long-term contract re-pricing","Astana listing flows"], dc:{f:1000,gr:8,w:9,tg:2,sh:260}, ms:{up:.95,gp:.9,pl:.7,dm:.95}, fin:{beta:1.6,eps:5.50,div:2.20,rg:[8,18,28,20,15]}, rs:[["Uranium production",91],["Fuel cycle (UF6, fabrication)",5],["Other",4]], geo:[["Kazakhstan (mining)",100],["Export: Asia",50],["Export: Europe",30],["Export: Americas",20]], tc:[["CGNPC (China)",18],["KEPCO (Korea)",14],["EDF (France)",11],["Orano",10],["Cameco (Inkai JV)",8],["Other",39]], pl:[{name:"Inkai JV (60% w/ CCJ)",desc:"Flagship ISR · low-cost output",pos:"Tier-1"},{name:"South Inkai · Karatau",desc:"Fully-owned ISR assets",pos:"Volume"},{name:"Budenovskoye",desc:"New development · Samruk-Kazyna partner",pos:"Growth"},{name:"UEP · Ulba",desc:"UF6 conversion + fuel fabrication in-country",pos:"Vertical integration"},{name:"Fuel Fabrication JV (Ulba-TVS)",desc:"Joint with TVEL (Russia)",pos:"Strategic"}], cp:["CCJ","NXE","PDN","BOE","UEC","Orano (private)"], ops:{hq:"Astana, Kazakhstan",fd:1997,emp:23000,ne:"Aug 2026 (semi-annual)"}, own:{insider:75,institutional:15} },
  { t:"PDN", themes:["uranium"], cc:"🇦🇺", nm:"Paladin Energy", v:"uranium", s:"Producer", r:247, g:40, mc:2400, pe:null, pr:"Langer Heinrich uranium mine (Namibia) · Target 4.75 Mlb/yr", d:"Australian-listed uranium producer. Restarted Langer Heinrich in Namibia 2024 after years of care/maintenance. Targeting 4.75 Mlb annual production. Primary ASX pure-play uranium producer.", ri:["Namibia operating risk","Commissioning ramp rate"], ca:["Full production ramp","Long-term contract signings","Fission acquisition integration"], dc:{f:60,gr:30,w:12,tg:3,sh:300}, ms:{up:.95,gp:.75,pl:.5,dm:.9}, fin:{beta:2.2,eps:.30,div:0,rg:[10,30,60,70,40]}, rs:[["Uranium production (Langer Heinrich)",90],["Fission acquisition (developer)",10]], geo:[["Namibia",65],["Canada (Fission PLS)",25],["Other exploration",10]], tc:[["Long-term utilities",75],["Spot market",25]], pl:[{name:"Langer Heinrich (Namibia)",desc:"Restarted 2024 · ramping to 4.75 Mlb/yr",pos:"Producer"},{name:"Patterson Lake South (Fission acq)",desc:"Canadian Athabasca asset · 2024 acquisition",pos:"Development pipeline"},{name:"Michelin/Aurora projects",desc:"Canadian exploration",pos:"Long-term"}], cp:["CCJ","KAP","NXE","BOE","DNN","UEC"], ops:{hq:"Perth, Australia",fd:1993,emp:500,ne:"Aug 2026 (semi-annual)"}, own:{insider:2,institutional:60} },
  { t:"BOE", themes:["uranium"], cc:"🇦🇺", nm:"Boss Energy", v:"uranium", s:"Producer", r:60, g:35, mc:900, pe:null, pr:"Honeymoon ISR (SA) · 30% stake in Alta Mesa (US)", d:"Australian uranium producer. Brought Honeymoon ISR mine (South Australia) back online 2024. Holds 30% of Alta Mesa (TX) alongside enCore. FY26 feasibility restate pending after mineralization revisions.", ri:["Feasibility study revisions","Small production base"], ca:["Honeymoon ramp","Q3 2026 feasibility update","Alta Mesa ramp"], dc:{f:10,gr:40,w:13,tg:3,sh:405}, ms:{up:.95,gp:.5,pl:.5,dm:.85}, fin:{beta:2.0,eps:.05,div:0,rg:[-20,30,60,80,45]}, rs:[["Uranium (Honeymoon SA)",72],["Alta Mesa (30% JV)",28]], geo:[["Australia (SA)",70],["US (TX · via 30% JV)",30]], tc:[["Long-term utilities",60],["Spot market",40]], pl:[{name:"Honeymoon ISR",desc:"Restarted Apr 2024 · 2.5 Mlb/yr nameplate",pos:"Producer"},{name:"Alta Mesa (30% JV w/ enCore)",desc:"Texas ISR · production",pos:"US foothold"},{name:"Feasibility study (due Q3 2026)",desc:"Post-withdrawal · mineralization update",pos:"Key catalyst"}], cp:["CCJ","KAP","NXE","PDN","UEC","URG"], ops:{hq:"Perth, Australia",fd:2008,emp:140,ne:"Aug 2026"}, own:{insider:3,institutional:40} },

  /* ═══════════════ DEFENSE — CURTISS-WRIGHT ═══════════════ */
  { t:"CW", themes:["defense","nuclear","space"], cc:"🇺🇸", nm:"Curtiss-Wright", v:"electronics", s:"Sensors", r:3100, g:37, mc:18000, pe:32, pr:"Naval reactor pumps · Flight controls · Nuclear plant services", d:"Critical naval nuclear reactor components (pumps, motors, valves) for Columbia/Virginia subs and carriers. Also defense electronics and commercial nuclear plant services. Beneficiary of both naval buildup and nuclear renaissance.", ri:["Long product cycles","Program timing lumpiness"], ca:["Columbia-class full-rate","SMR component qualification","Commercial nuclear uprate cycle"], dc:{f:500,gr:8,w:9,tg:2,sh:38}, ms:{bg:.85,cf:.7,ex:.3,ra:.4,pp:.7,pl:.8,ur:.3,ai:.6}, fin:{beta:1.0,eps:12.00,div:.84,rg:[5,8,12,14,13]}, rs:[["Defense Electronics",35],["Naval & Power",40],["Aerospace & Industrial",25]], geo:[["US",77],["International",23]], tc:[["US Navy (sub/carrier reactors)",38],["US Air Force",15],["Commercial nuclear",12],["International defense",20],["Industrial",15]], pl:[{name:"Naval Reactor Pumps",desc:"Columbia/Virginia sub + Ford carrier pumps · sole-source",pos:"Monopoly position"},{name:"Nuclear Plant Services",desc:"Commercial reactor pump/valve aftermarket",pos:"SMR qualification opportunity"},{name:"Flight Control Actuators",desc:"F-35/F-16/JLTV actuators",pos:"Franchise"},{name:"TTC (tactical data)",desc:"Tactical data recording for aerospace",pos:"Growth"},{name:"Industrial Automation",desc:"Nuclear + industrial valves",pos:"Cyclical"}], cp:["HEI","TDG","MRCY","Crane NXT (spinoff)"], ops:{hq:"Davidson, NC",fd:1929,emp:9100,ne:"May 2026"}, own:{insider:.3,institutional:88} },

  /* ═══════════════ POST-QUANTUM SECURITY ═══════════════ */
  { t:"LAES", themes:["quantum"], cc:"🇨🇭", nm:"SEALSQ Corp", v:"security", s:"PQC", r:18, g:45, mc:750, pe:null, pr:"QS7001 PQC chips · QVault TPM · Secure semiconductors", d:"Post-quantum cryptography chip pure-play (spun from WISeKey). Ships quantum-resistant secure semiconductors for IoT, automotive, identity. $220M cash. Planned PQC-picosatellite constellation for space QKD. Targeting NIST PQC mandatory compliance deadlines.", ri:["Commercial scale gap vs ambition","Revenue concentration"], ca:["QS7001 design wins","NIST PQC compliance deadlines","Picosatellite launch"], dc:{f:-25,gr:70,w:14,tg:3,sh:55}, ms:{rd:.7,eg:.3,cl:.6,ra:.5}, fin:{beta:2.5,eps:-.40,div:0,rg:[10,40,80,100,80]} },

  /* ═══════════════ BIOTECH — ZEALAND ═══════════════ */
  // NOTE: ZEAL entry already exists above with richer data; leaving this section as a structural marker.

];

/* ────── Supply-chain edges: 843 labeled supplier relationships ────── */
const EDGES = [
  ["AXTI","LITE","InP"],["AXTI","COHR","InP"],["AXTI","AAOI","InP"],["IQE","LITE","Epi"],["IQE","COHR","Epi"],
  ["SOI","TSEM","SOI wafers"],["SOI","TSM","FD-SOI"],["LITE","FN","EML dies"],["COHR","FN","Laser dies"],
  ["AAOI","MSFT","Transceivers"],["AAOI","AMZN","Transceivers"],["TSEM","FN","SiPh wafers"],["TSEM","COHR","SiPh fab"],
  ["MRVL","FN","DSP chips"],["MRVL","AMZN","Custom XPU"],["MTSI","FN","TIA/drivers"],["MTSI","COHR","Analog ICs"],
  ["AVGO","ANET","Switch ASICs"],["AVGO","GOOG","TPU silicon"],["AVGO","META","Custom ASIC"],
  ["FN","ANET","Transceivers"],["FN","CSCO","Transceivers"],["FN","CIEN","Transceivers"],
  ["COHR","ANET","Transceivers"],["COHR","MSFT","Transceivers"],
  ["SIVE","FN","Light sources"],["LWLG","TSEM","EO polymer"],["POET","FN","Optical engines"],
  ["CIEN","EQIX","DCI transport"],["CIEN","DLR","DCI transport"],["NOK","EQIX","Optical"],
  ["AEHR","TSEM","Burn-in test"],["FORM","TSEM","Probe cards"],["FORM","SKHYNIX","HBM probes"],
  ["TSM","NVDA","3nm/CoWoS"],["TSM","AMD","3nm fab"],["TSM","AVGO","3nm fab"],["TSM","MRVL","5nm fab"],["TSM","ARM","Foundry"],
  ["SKHYNIX","NVDA","HBM3E"],["SKHYNIX","AMD","HBM3E"],["MU","NVDA","HBM3E"],["MU","AMD","HBM3E"],["SAMSUNG","NVDA","HBM/NAND"],["SAMSUNG","AMD","HBM"],
  ["NVDA","AMZN","GPUs"],["NVDA","MSFT","GPUs"],["NVDA","GOOG","GPUs"],["NVDA","META","GPUs"],["NVDA","CRWV","GPUs"],
  ["AMD","MSFT","MI300X"],["AMD","META","MI300X"],["AMD","AMZN","EPYC/MI300"],
  // Marvell confirmed: ASIC co-design for all 4 hyperscalers + NVIDIA NVLink Fusion ($2B investment)
  ["MRVL","MSFT","Maia ASIC"],["MRVL","GOOG","Axion/TPU"],["MRVL","NVDA","NVLink Fusion"],
  // Arista confirmed: Microsoft + Meta each >10% of revenue, plus Google and Amazon
  ["ANET","MSFT","AI switches"],["ANET","META","DES switches"],["ANET","GOOG","Switches"],["ANET","AMZN","Switches"],
  ["ANET","EQIX","Switches"],["ANET","DLR","Switches"],
  ["CSCO","EQIX","Networking"],["CSCO","AMZN","Networking"],["CSCO","MSFT","Networking"],["CSCO","DLR","Networking"],
  ["JNPR","EQIX","Networking"],
  // Vertiv confirmed: NVIDIA co-developed GB200 reference architecture, supplies all hyperscalers
  ["VRT","NVDA","GB200 cooling"],["VRT","EQIX","Cooling"],["VRT","DLR","Cooling"],["VRT","CRWV","Cooling"],
  ["VRT","AMZN","Liquid cooling"],["VRT","MSFT","Liquid cooling"],
  ["ETN","EQIX","Electrical"],["ETN","DLR","Electrical"],["ETN","AMZN","Power dist"],["ETN","MSFT","Power dist"],["ETN","CRWV","Power dist"],
  ["GEV","EQIX","Power gen"],["GEV","DLR","Power gen"],["GEV","AMZN","Power gen"],["GEV","MSFT","Power gen"],
  ["POWL","EQIX","Switchgear"],["POWL","DLR","Switchgear"],
  // Coherent confirmed: transceivers to multiple hyperscalers
  ["COHR","AMZN","Transceivers"],["COHR","GOOG","Transceivers"],["COHR","META","Transceivers"],
  // Fabrinet confirmed: assembles for NVIDIA directly (optical modules), plus Lumentum/Coherent/Ciena
  ["FN","NVDA","Optical modules"],
  // DC Infra confirmed relationships
  ["EQIX","AMZN","DC space"],["EQIX","MSFT","DC space"],["EQIX","GOOG","DC space"],["EQIX","CRWV","DC space"],
  ["DLR","GOOG","DC space"],["DLR","META","DC space"],["DLR","AMZN","DC space"],["DLR","CRWV","DC space"],
  // CoreWeave confirmed: sells GPU cloud to Microsoft (62% rev), Meta ($35B+), also NVIDIA dedicated
  ["CRWV","MSFT","GPU cloud"],["CRWV","META","GPU cloud"],["CRWV","NVDA","AI supercomputer"],
  // Broadcom confirmed: custom ASICs for Google TPU + Meta + Amazon networking
  ["AVGO","AMZN","Networking ASICs"],
  ["INTC","AMZN","Gaudi chips"],["ARM","NVDA","CPU IP"],["ARM","AMZN","Graviton IP"],["ARM","MSFT","Cobalt IP"],["ARM","GOOG","Axion IP"],
  ["ALMU","TSM","III-V R&D"],

  // Amkor packaging (CoWoS OSAT)
  ["TSM","AMKR","CoWoS wafers"],["AMKR","NVDA","Packaged dies"],["AMKR","AMD","Packaged dies"],["AMKR","AVGO","Packaged dies"],
  // Dell AI servers
  ["NVDA","DELL","GPUs"],["ANET","DELL","Switches"],["DELL","CRWV","AI servers"],["DELL","AMZN","Servers"],["DELL","MSFT","Servers"],
  // Super Micro AI servers
  ["NVDA","SMCI","GPUs"],["ANET","SMCI","Switches"],["SMCI","CRWV","AI servers"],["SMCI","AMZN","Servers"],["SMCI","GOOG","Servers"],
  // Celestica contract manufacturing
  ["CLS","MSFT","Hardware"],["CLS","AMZN","Hardware"],["CLS","META","Hardware"],
  // Amphenol connectors/cables
  ["APH","NVDA","Connectors"],["APH","DELL","Connectors"],["APH","SMCI","Connectors"],["APH","EQIX","Cabling"],["APH","DLR","Cabling"],
  // Corning fiber optic
  ["GLW","EQIX","Fiber"],["GLW","DLR","Fiber"],["GLW","CIEN","Fiber"],["GLW","ANET","Fiber"],
  // Applied Digital AI DCs
  ["NVDA","APLD","GPUs"],["VRT","APLD","Cooling"],["APLD","MSFT","DC capacity"],
  // Core Scientific AI hosting
  ["NVDA","CORZ","GPUs"],["VRT","CORZ","Cooling"],["CORZ","CRWV","Hosting"],
  // Iron Mountain DC expansion
  ["IRM","AMZN","DC space"],["IRM","MSFT","DC space"],

  // Credo - connectivity ASICs for datacenter
  ["CRDO","FN","SerDes ICs"],["CRDO","ANET","Connectivity"],["CRDO","MSFT","Connectivity"],["CRDO","AMZN","Connectivity"],["TSM","CRDO","Fab"],
  // GlobalFoundries - specialty SiPh foundry
  ["GFS","COHR","SiPh fab"],["GFS","MRVL","RF fab"],["SOI","GFS","SOI wafers"],["LWLG","GFS","EO polymer"],
  // IPG Photonics - fiber lasers
  ["IPGP","FN","Fiber lasers"],["IPGP","COHR","Pump lasers"],["AXTI","IPGP","InP substrates"],
  // Onto Innovation - process control
  ["ONTO","TSM","Inspection"],["ONTO","TSEM","Inspection"],["ONTO","GFS","Inspection"],["ONTO","AMKR","Packaging insp."],
  // Viavi - network test
  ["VIAV","EQIX","Network test"],["VIAV","DLR","Network test"],["VIAV","ANET","Link validation"],["VIAV","CIEN","Link validation"],
  // SkyWater - US foundry
  ["SKYT","MRVL","US fab"],
  // LightPath - optical assemblies
  ["LPTH","FN","Optical parts"],
  // Himax - wafer-level optics
  ["HIMX","FN","WLO optics"],["HIMX","COHR","Display/optics"],

  /* ═══════════════ DEFENSE EDGES ═══════════════ */
  // Tier 2/3 components → Subsystems
  ["TDG","LMT","Components"],["TDG","NOC","Components"],["TDG","RTX","Engine parts"],["TDG","BA","Aerostructures"],
  ["HEI","LMT","Aftermarket"],["HEI","NOC","Aftermarket"],["HEI","RTX","Aftermarket"],["HEI","BA","Aftermarket"],
  // Electronics → Platforms
  ["MRCY","LMT","Mission computers"],["MRCY","NOC","Signal processing"],["MRCY","RTX","Radar compute"],["MRCY","LHX","Subsystems"],
  ["CUB","LMT","Training sims"],["CUB","NOC","C2 systems"],
  ["LHX","LMT","C4ISR"],["LHX","NOC","Tactical comms"],["LHX","BA","Avionics"],["LHX","RTX","EW"],
  // Missile / munition inter-prime supply
  ["RTX","LMT","AIM engines"],
  // Services (end customer is primes)
  ["PLTR","LMT","AIP integration"],["PLTR","NOC","Data platform"],
  // Unmanned
  ["KTOS","LMT","CCA teaming"],["KTOS","NOC","Target drones"],
  ["AVAV","LMT","Drone integration"],
  ["RKLB","NOC","HASTE flight"],
  // BWXT supplies Navy primes
  ["BWXT","HII","Naval reactors"],["BWXT","GD","Sub reactors"],
  // Defense lasers
  ["LASR","LMT","Directed energy"],
  // Textron Bell / V-280
  ["TDG","TXT","Bell components"],["HEI","TXT","Aftermarket"],

  /* ═══════════════ DRONES EDGES ═══════════════ */
  // Silicon → drone makers
  ["NVDA","ONDS","AI compute"],["NVDA","RCAT","Edge AI"],["NVDA","AVAV","Sensor fusion"],
  ["ADI","RCAT","RF front-ends"],["ADI","AVAV","RF/sensors"],["ADI","KTOS","Mixed-signal"],["ADI","ONDS","RF"],
  ["CRDO","NVDA","Interconnect"],
  // Components (parts) → makers
  ["HEI","AVAV","Aftermarket"],["HEI","RCAT","Aftermarket"],["TDG","KTOS","Components"],
  // Makers → Primes
  ["AVAV","LMT","Drone integration"],["KTOS","LMT","CCA teaming"],["KTOS","NOC","Target drones"],
  ["RCAT","LMT","SRR integration"],["ONDS","RTX","Counter-UAS"],["ONDS","LHX","Surveillance"],
  ["PDYN","LMT","Autonomy software"],["PDYN","NOC","AI autonomy"],
  ["AIRO","LMT","Coyote integration"],
  // Software autonomy
  ["PDYN","KTOS","Autonomy"],["PDYN","AVAV","Autonomy"],

  /* ═══════════════ SPACE EDGES ═══════════════ */
  // Propulsion / components → Launch
  ["AJRD","RKLB","Propulsion"],["ROK","RKLB","Controls"],["HEI","RKLB","Components"],
  // Launch → Payloads
  ["RKLB","ASTS","Launch services"],["RKLB","PL","Launch"],["RKLB","SPIR","Launch"],["RKLB","BKSY","Launch"],
  // Payloads → Primes
  ["PL","LMT","EO imagery"],["PL","NOC","NGA data"],["PL","LHX","EO data"],
  ["SPIR","LHX","RF data"],["SPIR","LMT","Weather data"],
  ["BKSY","NOC","NRO imagery"],["BKSY","LMT","Intel data"],
  ["MAXR","LMT","High-res EO"],["MAXR","NOC","NGA EOCL"],
  ["ASTS","LMT","D2D partnership"],
  // Constellations
  ["IRDM","LMT","L-band data"],["IRDM","NOC","DoD comms"],
  // Propulsion to primes
  ["AJRD","LMT","Solid motors"],["AJRD","NOC","Solid motors"],

  /* ═══════════════ ROBOTICS EDGES ═══════════════ */
  // Silicon → Systems
  ["NVDA","TSLA","GPU · Dojo"],["NVDA","SYM","Edge AI"],["NVDA","FANUY","Vision"],
  ["NVDA","ISRG","Vision compute"],["NVDA","KSCP","Compute"],
  ["ADI","FANUY","Motion control"],["ADI","ABBNY","Motion sensors"],["ADI","EMR","Sensors"],["ADI","TSLA","Sensors"],
  ["TER","TSLA","Test equipment"],["TER","FANUY","Test"],
  // Motion components → Systems
  ["ROK","TSLA","Control systems"],["ROK","FANUY","Controls"],
  ["EMR","FANUY","Process"],["EMR","ABBNY","Process"],
  ["ABBNY","ZBRA","Logistics automation"],["ABBNY","SYM","Motion"],
  // Industrial / logistics cross-flow
  ["SYM","ZBRA","Warehouse"],

  /* ═══════════════ QUANTUM EDGES ═══════════════ */
  // Classical GPU → Quantum hardware (co-processing)
  ["NVDA","IONQ","CUDA-Q"],["NVDA","IBM","Qiskit integration"],["NVDA","RGTI","CUDA-Q"],
  ["AMD","IBM","HPC infra"],
  // Tech giants in quantum
  ["GOOG","IBM","Quantum research"],["MSFT","IONQ","Azure Quantum"],["MSFT","QBTS","Azure Quantum"],
  // Consulting / integration
  ["BAH","IBM","Consulting"],["BAH","IONQ","DoD integration"],
  // Honeywell / Quantinuum
  ["HON","IBM","Quantum ecosystem"],

  /* ═══════════════ BIOTECH · GLP-1 EDGES ═══════════════ */
  // CDMO → Incumbents
  ["CTLT","NVO","Wegovy fill-finish"],["CTLT","LLY","Fill-finish"],
  ["LNZA","LLY","Biologics CDMO"],["LNZA","AMGN","Biologics CDMO"],
  ["RGEN","LLY","Bioprocessing"],["RGEN","NVO","Bioprocessing"],["RGEN","AMGN","Bioprocessing"],
  // Devices → Incumbents
  ["BDX","LLY","Needles/syringes"],["BDX","NVO","Needles/syringes"],
  ["WST","LLY","Stoppers/plungers"],["WST","NVO","Stoppers/plungers"],["WST","AMGN","Injectable devices"],
  // Next-gen → Incumbents (competitive / M&A)
  ["VKTX","LLY","M&A candidate"],["VKTX","NVO","Competitive"],
  ["ALT","LLY","Competitive"],["TERN","LLY","Competitive"],

  /* ═══════════════ BATTERIES EDGES ═══════════════ */
  // Materials → Cells
  ["ALB","CATL","Lithium"],["ALB","TSLA","Lithium"],["ALB","LGEM","Lithium"],
  ["PLL","TSLA","Lithium"],["LAC","TSLA","Lithium (Thacker Pass / GM)"],
  ["MP","TSLA","Neodymium magnets"],
  // Cells → Integrators
  ["CATL","TSLA","LFP cells"],["CATL","FLNC","LFP cells"],
  ["PANW_BAT","TSLA","Cells"],["LGEM","TSLA","Cells"],
  // Integrators → End markets
  ["FLNC","D","Grid BESS"],["FLNC","SO","Grid BESS"],["STEM","CEG","C&I BESS"],
  // Inverters → Residential/Grid
  ["ENPH","FSLR","Residential solar"],["SEDG","FSLR","Residential solar"],
  // Bloom Energy → Datacenters
  ["BE","AMZN","Fuel cell power"],["BE","MSFT","Fuel cell power"],

  /* ═══════════════ URANIUM EDGES ═══════════════ */
  // Miners → Enrichment (cross-over with Nuclear theme)
  ["NXE","LEU","Future U3O8"],["UUUU","LEU","U3O8 processing"],
  // ETF holdings (representative)
  ["CCJ","URA","Top holding"],["NXE","URA","Holding"],["UEC","URA","Holding"],
  ["DNN","URA","Holding"],["CCJ","SPUT","Via spot buys"],
  // Lithium / REE in miners context
  ["LAC","ALB","Li peer"],["MP","ALB","Critical minerals"],

  /* ═══════════════ NUCLEAR EDGES ═══════════════ */
  // Mining → Fuel cycle
  ["CCJ","LEU","U3O8 feed"],["DNN","CCJ","Joint ventures"],["UEC","LEU","U3O8 feed"],["URG","LEU","U3O8 feed"],
  // Fuel cycle → Reactors (SMR)
  ["LEU","OKLO","HALEU fuel"],["LEU","SMR","HALEU fuel"],["LEU","NNE","HALEU fuel"],
  // Fuel → Utilities (existing reactors)
  ["CCJ","CEG","Fuel supply"],["CCJ","VST","Fuel supply"],["CCJ","D","Fuel supply"],["CCJ","SO","Fuel supply"],
  ["LEU","CEG","LEU enrichment"],["LEU","VST","LEU enrichment"],["LEU","D","LEU enrichment"],
  // Engineering / EPC → Reactors
  ["BWXT","SMR","Reactor components"],["BWXT","OKLO","Microreactor components"],
  ["FLR","SMR","NuScale parent"],["FLR","D","EPC services"],
  // SMR → Utilities / AI hosting
  ["OKLO","CEG","Microreactor supply"],["SMR","VST","SMR deployment"],
  // Utilities → AI datacenters / grid
  ["CEG","AMZN","AI DC PPAs"],["CEG","MSFT","TMI restart PPA"],["CEG","GOOG","AI DC PPAs"],
  ["VST","MSFT","Nuclear PPAs"],["VST","META","Nuclear PPAs"],
  ["D","GOOG","VA DC power"],["D","META","VA DC power"],
  ["SO","GOOG","GA DC power"],["SO","META","GA DC power"],
  ["NRG","AMZN","TX capacity"],

  /* ═══════════════ DRONES EDGES ═══════════════ */
  // Silicon → Drones
  ["NVDA","RCAT","AI compute"],["NVDA","ONDS","Compute"],["NVDA","PDYN","Autonomy compute"],
  ["ADI","RCAT","RF + mixed-signal"],["ADI","AIRO","RF"],["ADI","AVAV","Sensors"],["ADI","KTOS","Mixed-signal"],
  ["CRDO","RCAT","High-speed IO"],
  // Parts → Drones
  ["HEI","AVAV","Components"],["HEI","KTOS","Aftermarket"],["TDG","AVAV","Sensors"],["TDG","KTOS","Subsystems"],
  // Drones → Primes
  ["RCAT","LMT","SRR integration"],["AVAV","LMT","UAS teaming"],["KTOS","NOC","Target drones"],
  ["AVAV","NOC","UAS supply"],["ONDS","LMT","Counter-UAS"],
  // Autonomy software → drone makers
  ["PDYN","KTOS","Autonomy stack"],["PDYN","AVAV","Behavior software"],

  /* ═══════════════ SPACE EDGES ═══════════════ */
  // Propulsion → Launch
  ["AJRD","RKLB","Solid motors"],["ROK","MAXR","Control systems"],["HEI","RKLB","Structural parts"],
  // Launch → Payloads
  ["RKLB","ASTS","Launch contracts"],["RKLB","PL","Electron launches"],["RKLB","SPIR","Dedicated launch"],
  ["RKLB","BKSY","Rideshare payloads"],
  // Payloads → Primes
  ["PL","LMT","Imagery integration"],["PL","NOC","Intel feeds"],
  ["BKSY","LMT","NRO integration"],["BKSY","NOC","Classified"],
  ["MAXR","NOC","Geospatial intel"],["MAXR","LMT","EO integration"],
  ["SPIR","LHX","RF data"],["IRDM","LHX","Comms"],
  ["ASTS","NOC","D2D satellite supply"],

  /* ═══════════════ ROBOTICS EDGES ═══════════════ */
  // Silicon → Systems
  ["NVDA","TSLA","Dojo + Orin compute"],["NVDA","SYM","AI compute"],["NVDA","FANUY","Vision GPU"],
  ["ADI","TSLA","Motor controllers"],["ADI","EMR","Sensors"],["ADI","ABBNY","Sensors"],
  ["TER","FANUY","Test equipment"],["TER","ABB","Cobot test"],
  // Motion components → Systems
  ["ROK","TSLA","Automation controls"],["ROK","SYM","Control systems"],["ROK","EMR","Integration"],
  ["EMR","FANUY","Process integration"],["ABB","SYM","AMR partnership"],
  // Industrial ↔ Humanoid
  ["FANUY","TSLA","Factory robot precedent"],["ABBNY","TSLA","Arm benchmarking"],

  /* ═══════════════ QUANTUM EDGES ═══════════════ */
  // Classical GPU → Quantum hardware (hybrid workflows)
  ["NVDA","IONQ","CUDA-Q integration"],["NVDA","IBM","Hybrid HPC"],["NVDA","RGTI","GPU integration"],
  ["AMD","IBM","Classical compute"],
  // Cloud giants ↔ pure-play quantum
  ["MSFT","IONQ","Azure Quantum"],["MSFT","RGTI","Azure Quantum"],["MSFT","QBTS","Azure Quantum"],
  ["GOOG","IONQ","Braket alternative"],["GOOG","IBM","Quantum research"],
  // Consulting integration
  ["BAH","IBM","Federal quantum consulting"],["BAH","HON","Quantinuum integration"],
  ["IBM","HON","Error correction research"],

  /* ═══════════════ BIOTECH / GLP-1 EDGES ═══════════════ */
  // Next-gen biotechs are competitive/potential M&A targets of incumbents
  ["VKTX","LLY","M&A speculation / pipeline competition"],
  ["VKTX","NVO","M&A speculation / pipeline competition"],
  ["ALT","LLY","Pipeline competition"],["TERN","LLY","Oral GLP-1 competition"],
  // CDMO → Incumbents
  ["CTLT","NVO","Wegovy fill-finish"],["CTLT","LLY","Fill-finish capacity"],
  ["LNZA","LLY","Biologics CDMO"],["LNZA","NVO","Biologics CDMO"],
  ["RGEN","LLY","Bioprocessing consumables"],["RGEN","NVO","Bioprocessing consumables"],
  ["RGEN","LNZA","Bioprocessing equipment"],
  // Devices → Incumbents
  ["BDX","LLY","Needles and syringes"],["BDX","NVO","Needles and syringes"],
  ["WST","LLY","Pen components"],["WST","NVO","Pen components"],["WST","AMGN","Autoinjector seals"],

  /* ═══════════════ BATTERIES EDGES ═══════════════ */
  // Materials → Cells
  ["ALB","CATL","Lithium supply"],["ALB","PANW_BAT","Lithium supply"],["ALB","TSLA","Lithium contract"],
  ["PLL","TSLA","NC spodumene"],
  ["MP","TSLA","Magnets"],
  // Cells → Integrators / OEM
  ["CATL","TSLA","LFP cells (Shanghai)"],["CATL","FLNC","BESS cells"],
  ["PANW_BAT","TSLA","NCM cells (US)"],["LGEM","PANW_BAT","Parent entity"],
  // Integrators → End markets
  ["FLNC","D","Utility BESS"],["FLNC","SO","Utility BESS"],["FLNC","CEG","Utility BESS"],
  ["STEM","SO","C&I storage"],
  ["BE","AMZN","DC power"],["BE","MSFT","DC power"],
  // Residential + solar
  ["ENPH","FSLR","Inverter + panel packages"],["SEDG","FSLR","Utility inverters"],
  ["ENPH","TSLA","Competitor residential"],

  /* ═══════════════ URANIUM EDGES ═══════════════ */
  // Uranium miners overlap with Nuclear miners
  ["NXE","LEU","Future enrichment feed"],["UUUU","LEU","Feed + REE pivot"],
  // ETF holdings
  ["CCJ","URA","ETF holding"],["NXE","URA","ETF holding"],["DNN","URA","ETF holding"],
  ["UEC","URA","ETF holding"],["LEU","URA","ETF holding"],
  ["CCJ","SPUT","Spot purchases"],
  // Rare earths / lithium parallel thesis
  ["MP","LAC","US critical minerals cohort"],["ALB","LAC","Lithium peers"],

  /* ═══════════════ CRYPTO EDGES ═══════════════ */
  // Hardware/power → Miners
  ["CORZ","MARA","Hosting relationship"],["CORZ","RIOT","Hosting relationship"],
  ["APLD","CLSK","Hosting agreement"],["APLD","HUT","AI hosting JV"],
  // Miners → Exchanges (custody / sell flow)
  ["MARA","COIN","Treasury custody"],["RIOT","COIN","Treasury custody"],
  ["CLSK","COIN","Treasury custody"],["HUT","COIN","Treasury custody"],
  // Exchanges → Treasuries
  ["COIN","MSTR","BTC acquisition venue"],["COIN","SMLR","BTC acquisition venue"],
  ["HOOD","MSTR","Retail BTC flow"],
  // AI pivot miners
  ["HUT","NVDA","GPU procurement"],["GLXY","NVDA","AI hosting GPUs"],
  ["CORZ","MSTR","Power + BTC treasury overlap"],

  /* ═══════════════ PASS 4 EDGES ═══════════════ */

  // AI · Semi equipment → foundries
  ["ASML","TSM","EUV systems"],["ASML","INTC","EUV systems"],["ASML","SKHYNIX","EUV systems"],["ASML","SAMSUNG","EUV systems"],
  ["AMAT","TSM","Deposition/etch"],["AMAT","INTC","Process tools"],["AMAT","SKHYNIX","HBM capex"],
  ["LRCX","TSM","Etch/deposition"],["LRCX","SAMSUNG","Memory etch"],["LRCX","SKHYNIX","HBM etch"],["LRCX","MU","Memory etch"],
  ["KLAC","TSM","Inspection"],["KLAC","INTC","Metrology"],["KLAC","SAMSUNG","Inspection"],
  // EDA → fabless
  ["SNPS","NVDA","EDA tools"],["SNPS","AMD","EDA tools"],["SNPS","AVGO","EDA tools"],["SNPS","ARM","IP licensing"],
  ["CDNS","NVDA","EDA tools"],["CDNS","AMD","EDA tools"],["CDNS","MRVL","EDA tools"],["CDNS","ALAB","EDA tools"],

  // Defense · European primes
  ["RNMBY","BAESY","Joint programs"],
  ["FINMY","BAESY","GCAP partner"],
  ["ESLT","LMT","Helmet systems F-35"],["ESLT","NOC","EW subsystems"],
  ["MOG.A","LMT","Actuators"],["MOG.A","RTX","Missile guidance"],["MOG.A","BA","Flight control"],
  ["OSK","LMT","JLTV partnership (historical)"],["TDG","OSK","Components"],
  ["LDOS","BAESY","JV programs"],

  // Nuclear · utilities → AI hyperscalers
  ["TLN","AMZN","1.92GW AWS PPA through 2042"],
  ["NEE","GOOG","25-yr 3GW Alphabet PPA"],
  ["EXC","AMZN","VA/IL DC power"],["EXC","GOOG","VA/IL DC power"],
  ["PEG","AMZN","NJ DC power"],["PEG","META","NJ DC power"],
  ["XEL","META","MN/CO DC power"],["XEL","GOOG","MN DC power"],
  // Nuclear fuel → new utilities
  ["CCJ","TLN","Uranium fuel supply"],["CCJ","NEE","Uranium supply"],["CCJ","EXC","Uranium supply"],
  ["LEU","TLN","LEU enrichment"],

  // Space · supply chain
  ["AJRD","LUNR","Propulsion"],["AJRD","FLY","Solid motors"],
  ["RDW","NOC","Solar arrays"],["RDW","LMT","Sensors"],["RDW","BA","ROSA arrays"],
  ["LUNR","LHX","SDA Tranche 3 subcontract"],["LUNR","NOC","Lunar prime partner"],
  ["FLY","LMT","Alpha small sat launches"],["FLY","NOC","Blue Ghost payloads"],
  ["VOYG","NOC","Starlab defense IP"],
  // Redwire → Drones (Edge Autonomy)
  ["RDW","KTOS","Edge Autonomy integration"],
  // Firefly to AI
  ["NVDA","FLY","Compute onboard"],

  // Drones
  ["PDYN","DPRO","SwarmOS autonomy"],
  ["DPRO","LMT","ISR integration"],
  ["ADI","DPRO","RF + sensors"],["ADI","UAVS","Sensors"],
  ["UAVS","LMT","eBee TAC defense"],

  // Robotics
  ["NVDA","RR","Jetson Thor"],["NVDA","SERV","Compute + investment"],["NVDA","XPEV","Compute"],
  ["ADI","RR","Sensor ICs"],
  ["XPEV","TSLA","Humanoid benchmarking"],

  // Quantum
  ["NVDA","INFQ","CUDA-Q"],["NVDA","XANM","Partnership"],["NVDA","ARQQ","PQC research"],
  ["MSFT","INFQ","Azure Quantum"],["MSFT","XANM","Azure Quantum"],
  ["GOOG","XANM","Research collab"],
  ["BAH","INFQ","Federal consulting"],["BAH","ARQQ","PQC consulting"],

  // Biotech · GLP-1
  ["PFE","LLY","Category competitor"],["RHHBY","LLY","Category competitor"],["AZN","LLY","Category competitor"],
  ["ZEAL","RHHBY","Petrelintide partnership"],
  ["GPCR","LLY","Oral GLP-1 competition"],
  ["CTLT","PFE","CDMO"],["LNZA","PFE","Biologics CDMO"],["LNZA","RHHBY","Biologics CDMO"],
  ["BDX","PFE","Syringes/pens"],["BDX","RHHBY","Delivery systems"],
  ["WST","PFE","Component seals"],["WST","RHHBY","Autoinjector seals"],
  ["RGEN","RHHBY","Bioprocessing"],

  // Batteries · solid-state + zinc
  ["QS","TSLA","Potential future cell supply"],
  ["SLDP","TSLA","Electrolyte materials"],
  ["ALB","QS","Lithium supply"],["ALB","SLDP","Lithium supply"],
  ["EOSE","D","Utility BESS"],["EOSE","SO","Utility BESS"],
  ["FREY","TSLA","US LFP supply"],

  // Uranium / rare earths
  ["USAR","LMT","Magnets for motors"],["USAR","RTX","Magnets for weapons"],
  ["USAR","TSLA","Magnets for motors"],
  ["NATKY","LEU","Uranium feed"],["NATKY","CEG","Fuel supply"],
  ["NATKY","URA","ETF holding"],["NATKY","SPUT","Physical inventory"],

  // Crypto · AI pivot (the biggest new cluster)
  ["IREN","MSFT","$9.7B 5-yr Microsoft GB300 hosting"],
  ["CIFR","AMZN","15-yr AWS hosting lease"],
  ["CIFR","GOOG","Fluidstack equity + partnership"],
  ["WULF","GOOG","$3.2B strategic backstop"],
  ["IREN","NVDA","GB300 GPUs"],["CIFR","NVDA","H100/Blackwell GPUs"],["WULF","NVDA","AI GPUs"],
  ["CORZ","IREN","Power infrastructure peer"],
  ["APLD","WULF","Hosting peer"],["APLD","CIFR","Hosting peer"],
  ["BTDR","MARA","ASIC competitor / supplier"],["BTDR","RIOT","ASIC sales"],
  ["BTDR","CLSK","ASIC sales"],

  /* ═══════════════ PASS 5 — New coverage edges ═══════════════ */
  // eVTOL (Drones crossover)
  ["JOBY","RTX","Engine tech adjacency"],
  ["ACHR","PLTR","Next-gen aviation systems"],
  ["ACHR","KTOS","Hybrid VTOL interest"],
  // Naval nuclear props (Curtiss-Wright)
  ["CW","HII","Naval reactor pumps"],["CW","GD","Virginia/Columbia sub pumps"],["CW","BWXT","Reactor vendor partner"],
  ["CW","LMT","Defense electronics"],
  // International uranium miners → utilities + ETFs
  ["KAP","CEG","Long-term U supply"],["KAP","VST","Long-term U supply"],["KAP","D","U supply"],["KAP","SO","U supply"],
  ["KAP","URA","ETF top holding"],["KAP","SPUT","Physical purchases"],
  ["PDN","URA","ETF holding"],["BOE","URA","ETF holding"],
  ["PDN","CCJ","Western producer peer"],["BOE","UEC","US/AU peer"],
  // Post-quantum security
  ["LAES","IBM","PQC integration"],["LAES","HON","PQC chip partnerships"],
  ["LAES","ARQQ","PQC peer"],

  // ═══════════════ AEROSPACE MATERIALS → AIRFRAMES & ENGINES ═══════════════
  ["HXL","BA","Carbon composites"],["HXL","LMT","F-35 composites"],["HXL","NOC","B-21 composites"],
  ["HWM","BA","787/777 forgings"],["HWM","LMT","Fastener systems"],["HWM","RYCEY","Engine forgings"],
  ["ATI","BA","Ti structural"],["ATI","LMT","Ti + Ni alloys"],["ATI","RYCEY","Engine alloys"],["ATI","GEV","Nickel alloys"],
  ["CRS","BA","Superalloys"],["CRS","LMT","Specialty alloys"],["CRS","RYCEY","Turbine alloys"],

  // ═══════════════ JET + ROCKET ENGINES → AIRFRAMES ═══════════════
  ["RYCEY","BA","Trent engines"],["RYCEY","EADSY","Trent XWB"],["RYCEY","DUK","SMR partnership"],
  ["SAFRY","BA","LEAP-1B"],["SAFRY","EADSY","LEAP-1A"],["SAFRY","ERJ","Engines"],
  ["MHVYF","BA","Regional aircraft"],["MHVYF","NEE","APWR reactor legacy"],["MHVYF","GEV","BWR parts"],
  ["TGI","RYCEY","Triumph engine parts"],["TGI","BA","Airframe structures"],
  ["DCO","RYCEY","Engine components"],["DCO","SAFRY","Mechanical systems"],
  ["WWD","RYCEY","Actuators + fuel controls"],["WWD","BA","Flight controls"],
  ["PH","RYCEY","Engine hydraulics"],["PH","BA","Hydraulic systems"],["PH","LMT","Actuators"],
  ["KRMN","LMT","Missile structures"],["KRMN","NOC","Interstage"],["KRMN","RKLB","Payload protection"],
  ["AJRD","LMT","RS-25 + solid motors"],["AJRD","BA","ULA propulsion"],

  // ═══════════════ DEFENSE ELECTRONICS → PRIMES ═══════════════
  ["TDY","LMT","FLIR EO/IR"],["TDY","NOC","Sensor payloads"],["TDY","BA","Marine systems"],["TDY","RTX","Test systems"],
  ["MRCY","LMT","Subsystems"],["MRCY","NOC","Radar processors"],["MRCY","RTX","Mission computers"],
  ["HEI","LMT","Aftermarket parts"],["HEI","BA","Aftermarket"],["HEI","NOC","Components"],
  ["TDG","BA","Sole-source parts"],["TDG","LMT","Components"],["TDG","NOC","Components"],
  ["CW","LMT","Flight controls"],["CW","NOC","Actuators"],["CW","BA","Flight controls"],
  ["MOG.A","LMT","Missile actuators"],["MOG.A","BA","Actuators"],["MOG.A","NOC","Space actuators"],
  ["CUB","LMT","Defense electronics"],["CUB","NOC","Sensors"],
  ["FINMY","LMT","Radar systems"],["FINMY","BAESY","Eurofighter"],

  // ═══════════════ LAUNCH → SATELLITES + EO ═══════════════
  ["RKLB","IRDM","Satellite launches"],["RKLB","ASTS","BlueBird launches"],
  ["RKLB","PL","SuperDove launches"],["RKLB","BKSY","SAR launches"],["RKLB","SPIR","Rideshare"],
  ["FLY","PL","Rideshare"],["FLY","BKSY","Launches"],
  ["BWXT","RKLB","Space reactors"],["BWXT","LMT","Naval reactors"],

  // ═══════════════ SAT MANUFACTURERS + COMMERCIAL AERO ═══════════════
  ["LMT","IRDM","Iridium NEXT"],["LMT","MAXR","Legacy satellite"],
  ["NOC","MAXR","Earth obs partnership"],["BA","MAXR","Legacy"],
  ["EADSY","SAFRY","A320neo engines"],["EADSY","RYCEY","A350 engines"],
  ["THLLY","IRDM","Space electronics"],["THLLY","EADSY","Joint ventures"],
  ["CAE","BA","Pilot training"],["CAE","EADSY","Training"],["CAE","LMT","Military sims"],
  ["ERJ","SAFRY","Engines"],["LUNR","NASA","Lunar services"],
  ["VOYG","NASA","Space station"],

  // ═══════════════ OPERATORS → GOV / CARRIERS (abstract end markets) ═══════════════
  ["VSAT","LMT","Military broadband"],["VSAT","BA","Connectivity"],
  ["SATS","IRDM","Spectrum partner"],["GSAT","IRDM","Iridium peer"],
  ["MAXR","PL","EO peer"],["MAXR","BKSY","EO peer"],

  // ═══════════════ DEFENSE SERVICES ═══════════════
  ["SAIC","LMT","Integration services"],["SAIC","NOC","Engineering services"],
  ["LDOS","LMT","IT services"],["LDOS","NOC","Cyber services"],
  ["BAESY","LMT","F-35 rear fuselage"],["BAESY","NOC","International partnerships"],
  ["PLTR","LMT","AIP defense"],["PLTR","NOC","Foundry platform"],
  ["CACI","LMT","Intel services"],["CACI","NOC","Cyber"],
  ["BAH","LMT","Consulting"],["BAH","NOC","Consulting"],

  // ═══════════════ NUCLEAR FUEL CYCLE → REACTORS ═══════════════
  ["ASPI","OKLO","HALEU fuel"],["ASPI","NNE","Medical isotopes"],["ASPI","GEV","Enriched uranium"],
  ["LTBR","OKLO","Metallic fuel R&D"],["LTBR","NNE","Microreactor fuel"],["LTBR","BWXT","Fuel testing"],

  // ═══════════════ NUCLEAR HEAVY COMPONENTS → REACTOR OEMS ═══════════════
  ["HWM","BWXT","Naval forgings"],["HWM","GEV","Pressure vessels"],
  ["ATI","BWXT","Zirconium cladding"],["ATI","GEV","Alloy tubing"],
  ["CW","NEE","Reactor pumps"],["CW","SO","Flow controls"],["CW","DUK","Pumps"],

  // ═══════════════ NUCLEAR OEMS → UTILITIES ═══════════════
  ["GEV","DUK","BWRX-300 SMR"],["GEV","TLN","BWRX-300"],["GEV","CEG","GE reactor services"],
  ["SMR","DUK","VOYGR 12x77MW"],["SMR","CEG","NuScale partnership"],
  ["OKLO","TLN","Aurora siting"],["OKLO","VST","Data center reactors"],
  ["NNE","DOE","Microreactor"],["BWXT","NEE","Fuel services"],["BWXT","DUK","Reactor services"],

  // ═══════════════ NUCLEAR SERVICES + EPC ═══════════════
  ["PWR","NEE","Grid + nuclear services"],["PWR","DUK","Grid buildout"],
  ["PWR","VST","Transmission"],["PWR","TLN","Grid"],["PWR","CEG","Plant services"],
  ["FLR","OKLO","Aurora EPC"],["FLR","SMR","VOYGR EPC"],["FLR","GEV","BWRX-300 EPC"],
  ["J","DUK","Decommissioning"],["J","CEG","Cleanup services"],["J","SO","Savannah River"],

  // ═══════════════ NUCLEAR RADIATION MONITORING (MIR deployed everywhere) ═══════════════
  ["MIR","NEE","Rad monitoring"],["MIR","SO","Rad monitoring"],["MIR","DUK","Rad monitoring"],
  ["MIR","CEG","Rad monitoring"],["MIR","VST","Rad monitoring"],["MIR","TLN","Rad monitoring"],
  ["MIR","EXC","Rad monitoring"],["MIR","D","Rad monitoring"],["MIR","OKLO","SMR monitoring"],
  ["MIR","SMR","SMR monitoring"],["MIR","BWXT","Medical isotopes"],

  // ═══════════════ UTILITY → HYPERSCALER PPAs (core AI-nuclear thesis) ═══════════════
  ["CEG","MSFT","Three Mile Island PPA"],["TLN","AMZN","Susquehanna $650M"],
  ["VST","GOOG","Cooper Station PPA"],["CEG","META","4-plant clean energy"],
  ["DUK","GOOG","Carolinas SMR"],["NEE","GOOG","Solar + nuclear"],
  ["CMS","AMZN","Michigan DC load"],["DTE","MSFT","Michigan DC"],["EXC","GOOG","Chicago DC"],

  // ═══════════════ ROBOTICS — NVDA Isaac stack powers humanoids + industrial + surgical ═══════════════
  ["NVDA","TSLA","Isaac + Optimus AI"],["NVDA","XPEV","Humanoid AI"],["NVDA","KSCP","Vision AI"],["NVDA","RR","Vision AI"],
  ["NVDA","FANUY","Isaac Sim"],["NVDA","ABBNY","Isaac Sim"],["NVDA","YASKY","Isaac Sim"],["NVDA","SIEGY","Industrial AI"],
  ["NVDA","ISRG","Surgical AI"],["NVDA","SYK","Mako robotics AI"],["NVDA","MDT","Surgical AI"],
  ["NVDA","AMZN","Warehouse Jetson"],["NVDA","SYM","AMR Jetson"],

  // ═══════════════ ROBOTICS — ADI / MCHP motor control chips ═══════════════
  ["ADI","TSLA","Precision motion"],["ADI","XPEV","Motor control"],["ADI","FANUY","Motion ICs"],["ADI","ABBNY","Motion ICs"],
  ["ADI","YASKY","Servo chips"],["ADI","ISRG","Surgical precision"],
  ["MCHP","TSLA","Motor drivers"],["MCHP","XPEV","MCUs"],["MCHP","FANUY","Motor control"],["MCHP","ABBNY","MCUs"],
  ["MCHP","SIEGY","Automation MCUs"],["MCHP","KSCP","Motor drivers"],

  // ═══════════════ ROBOTICS — VISION/SENSORS → INDUSTRIAL + HUMANOID + LOGISTICS ═══════════════
  ["CGNX","FANUY","Machine vision"],["CGNX","ABBNY","Vision"],["CGNX","AMZN","Warehouse scanning"],["CGNX","YASKY","Vision"],
  ["KYCCF","FANUY","Sensors"],["KYCCF","ABBNY","Laser markers"],["KYCCF","SIEGY","Sensors"],
  ["HSAI","AMZN","LiDAR AMRs"],["HSAI","SYM","LiDAR"],["HSAI","KIOGY","LiDAR"],
  ["AMBA","TSLA","Vision SoCs"],["AMBA","AMZN","Delivery vision"],["AMBA","KSCP","Vision SoCs"],
  ["OUST","SYM","Industrial LiDAR"],["OUST","KIOGY","AMR LiDAR"],["OUST","AMZN","Scanning"],
  ["AME","ABBNY","Instrumentation"],["AME","EMR","Process sensors"],["AME","SIEGY","Test"],
  ["INVZ","FANUY","Auto LiDAR"],["LAZR","FANUY","Auto LiDAR"],

  // ═══════════════ ROBOTICS — MOTION / DRIVES → INDUSTRIAL + SURGICAL ═══════════════
  ["ROK","FANUY","ICS integration"],["ROK","ABBNY","Automation"],["ROK","EMR","Controls"],
  ["NOVT","ISRG","Precision motion"],["NOVT","MDT","Surgical drives"],["NOVT","GMED","Orthopedic"],["NOVT","PRCT","Precision drives"],
  ["HSCDY","FANUY","Drives"],["HSCDY","ABBNY","Motor drives"],["HSCDY","SIEGY","Drives"],
  ["SBGSY","FANUY","Automation components"],["SBGSY","EMR","Industrial controls"],
  ["OMRNY","FANUY","Sensors + PLCs"],["OMRNY","YASKY","Servo systems"],

  // ═══════════════ ROBOTICS — LOGISTICS / AMRs → AMZN (largest customer) ═══════════════
  ["SYM","AMZN","$11B warehouse contract"],["ZBRA","AMZN","RFID + scanning"],
  ["KIOGY","AMZN","Cognex-powered AMRs"],["FANUY","AMZN","Warehouse robotics"],

  // ═══════════════ QUANTUM — CRYOSTATS → SUPERCONDUCTING HARDWARE ═══════════════
  ["OXIGY","IBM","Dilution refrigerators"],["OXIGY","RGTI","Cryostats"],["OXIGY","QBTS","Annealer cryostats"],
  ["OXIGY","GOOG","Willow cryostats"],["OXIGY","MSFT","Majorana cryogenics"],["OXIGY","INTC","Tunnel Falls"],

  // ═══════════════ QUANTUM — LASERS → TRAPPED ION + ATOM + PHOTONIC ═══════════════
  ["MKSI","IONQ","Trapped ion lasers"],["MKSI","INFQ","Atom array lasers"],
  ["MKSI","QUBT","Photonic lasers"],["MKSI","XANM","Photonic lasers"],
  ["COHR","IONQ","Ultra-stable lasers"],["COHR","INFQ","Atom trap lasers"],["COHR","QUBT","Photonic sources"],
  ["COHR","GOOG","Quantum R&D lasers"],

  // ═══════════════ QUANTUM — FOUNDRY → HARDWARE ═══════════════
  ["SKYT","QBTS","D-Wave foundry"],["SKYT","RGTI","Superconducting foundry"],["SKYT","IONQ","$1.8B IonQ acquisition"],
  ["SKYT","ATOM","MST silicon"],

  // ═══════════════ QUANTUM — NETWORKING + PQC ═══════════════
  ["CIEN","QUBT","Quantum-safe Waveserver"],["CIEN","PANW","PQC networking"],
  ["PANW","CRWD","PQC peer"],["NET","VRSN","DNSSEC PQC"],

  // ═══════════════ QUANTUM — CLASSICAL BRIDGES (NVDA CUDA-Q) ═══════════════
  ["NVDA","IONQ","CUDA-Q hybrid"],["NVDA","RGTI","CUDA-Q integration"],["NVDA","IBM","Hybrid compute"],
  ["NVDA","QBTS","GPU + quantum hybrid"],["AMD","IONQ","HPC partnership"],
  ["INTC","IBM","Quantum partnership"],["INTC","ATOM","Silicon engineering"],

  // ═══════════════ QUANTUM — DEFENSE SENSING ═══════════════
  ["RTX","BAESY","Quantum sensing"],["RTX","IONQ","Navigation sensors"],
  ["BAESY","HON","UK quantum program"],
  ["BAH","IONQ","Federal quantum"],["BAH","IBM","Consulting"],

];

/* ────── AI theme: node positions + zone labels ────── */
const AI_POSITIONS = {
  // ── TIER 1: Raw Materials & Memory (Y ≈ 360) ──
  AXTI:[80,360], IQE:[150,365], SOI:[225,358],
  SKHYNIX:[460,360], MU:[540,365], SAMSUNG:[620,358],

  // ── TIER 2: Lasers, Foundry, Packaging (Y ≈ 300) ──
  LITE:[70,300], AAOI:[150,295], COHR:[235,302], IPGP:[310,298],
  TSEM:[380,300], GFS:[440,305], TSM:[520,298], INTC:[600,302],
  AMKR:[660,295], SKYT:[500,308],

  // ── TIER 3: Silicon, DSP, Assembly (Y ≈ 240) ──
  MRVL:[90,240], MTSI:[165,245], CRDO:[240,238], FN:[320,242],
  NVDA:[430,235], AMD:[520,240], AVGO:[610,238], ARM:[360,248],

  // ── TIER 4: CPO, Innovation, Test (Y ≈ 180) ──
  SIVE:[55,180], POET:[120,185], LWLG:[185,178], ALMU:[250,182],
  LPTH:[315,180], HIMX:[380,185], LASR:[100,295],
  AEHR:[450,178], FORM:[520,182], ONTO:[590,180], VIAV:[650,185],

  // ── TIER 5: Systems & Servers (Y ≈ 140) ──
  DELL:[420,140], SMCI:[510,138], CLS:[600,142],

  // ── TIER 6: Networking, Transport, Power (Y ≈ 100) ──
  ANET:[70,100], CSCO:[150,95], JNPR:[225,102],
  CIEN:[310,98], NOK:[385,100],
  APH:[460,95], GLW:[530,100], ALAB:[395,95],
  VRT:[590,98], ETN:[640,102], POWL:[555,108], GEV:[660,92],

  // ── TIER 7: DC Infrastructure (Y ≈ 55) ──
  EQIX:[200,55], DLR:[300,52], IRM:[110,58],
  CRWV:[420,55], APLD:[520,52], CORZ:[600,58], FRMI:[660,55],

  // ── TIER 8: Hyperscalers (Y ≈ 18) ──
  AMZN:[170,18], MSFT:[310,15], GOOG:[450,18], META:[580,15],
};

const AI_ZONE_LABELS = [
  [6, 370, "Raw materials & memory"],
  [6, 312, "Lasers, foundry & packaging"],
  [6, 252, "Silicon, DSP & assembly"],
  [6, 192, "CPO, innovation & test"],
  [6, 150, "Systems & servers"],
  [6, 110, "Networking, transport & power"],
  [6, 65, "DC infrastructure"],
  [6, 25, "Hyperscalers"],
];

/* ────── Sankey value-stream stages per theme ────── */
const AI_SANKEY_STAGES = [
  { label: "Inputs", groups: [
    { id: "test", label: "Equipment", tickers: ["AEHR","FORM","ONTO","VIAV"], bc: "#9c9690", side: "above" },
    { id: "substrates", label: "Substrates", tickers: ["AXTI","IQE","SOI"], bc: "#c89238", side: "below" },
  ]},
  { label: "Fabrication", groups: [
    { id: "memory", label: "Memory", tickers: ["SKHYNIX","MU","SAMSUNG"], bc: "#e88aa8", side: "above" },
    { id: "foundry", label: "Foundry", tickers: ["TSM","TSEM","GFS","SKYT","INTC","AMKR"], bc: "#b85878", side: "below" },
  ]},
  { label: "Photonics", groups: [
    { id: "lasers", label: "Photonics", tickers: ["LITE","COHR","AAOI","IPGP","LASR"], bc: "#e8c040", side: "below" },
  ]},
  { label: "Design", groups: [
    { id: "gpu", label: "Merchant GPU", tickers: ["NVDA","AMD"], bc: "#4872d8", side: "above" },
    { id: "asic", label: "Custom ASIC", tickers: ["AVGO","ARM"], bc: "#7890d8", side: "below" },
    { id: "dsp", label: "DSP & Optical", tickers: ["MRVL","MTSI","CRDO","FN","CIEN","NOK","POET","SIVE","LWLG","ALMU","LPTH","HIMX"], bc: "#9858b8", side: "below" },
  ]},
  { label: "Systems", groups: [
    { id: "servers", label: "Servers", tickers: ["DELL","SMCI","CLS"], bc: "#50a0c0", side: "above" },
    { id: "network", label: "Networking", tickers: ["ANET","CSCO","JNPR","APH","GLW","ALAB"], bc: "#b070d8", side: "below" },
  ]},
  { label: "Infra", groups: [
    { id: "power", label: "Power", tickers: ["VRT","ETN","POWL","GEV"], bc: "#40b070", side: "above" },
    { id: "reits", label: "DC REITs", tickers: ["EQIX","DLR","IRM"], bc: "#50b8b0", side: "below" },
    { id: "aicloud", label: "AI Cloud", tickers: ["CRWV","APLD","CORZ","FRMI"], bc: "#88b048", side: "below" },
  ]},
  { label: "Hyperscalers", groups: [
    { id: "amzn", label: "AWS", tickers: ["AMZN"], bc: "#f29060", side: "above" },
    { id: "msft", label: "Azure", tickers: ["MSFT"], bc: "#5ca8e0", side: "above" },
    { id: "goog", label: "GCP", tickers: ["GOOG"], bc: "#d88050", side: "below" },
    { id: "meta", label: "Meta", tickers: ["META"], bc: "#3e5fb8", side: "below" },
  ]},
];

const DEFENSE_SANKEY_STAGES = [
  { label: "Components", groups: [
    { id: "parts", label: "Aero Components", tickers: ["HEI","TDG"], bc: "#9c9690", side: "above" },
    { id: "sensors", label: "Sensors & Radar", tickers: ["MRCY","CUB"], bc: "#5E94E8", side: "below" },
  ]},
  { label: "Subsystems", groups: [
    { id: "electronics", label: "Electronics & EW", tickers: ["LHX"], bc: "#5E94E8", side: "above" },
    { id: "services", label: "Services & IT", tickers: ["LDOS","BAH","CACI","SAIC","PLTR"], bc: "#8e44ad", side: "below" },
  ]},
  { label: "Emerging", groups: [
    { id: "unmanned", label: "Unmanned & Autonomy", tickers: ["AVAV","KTOS","RKLB"], bc: "#c44040", side: "above" },
    { id: "lasers", label: "Directed Energy", tickers: ["LASR"], bc: "#e8c040", side: "below" },
    { id: "naval_prop", label: "Naval Nuclear", tickers: ["BWXT"], bc: "#2a9a70", side: "below" },
  ]},
  { label: "Primes", groups: [
    { id: "air", label: "Air Primes", tickers: ["LMT","NOC","BA"], bc: "#556b2f", side: "above" },
    { id: "missile", label: "Missile Primes", tickers: ["RTX"], bc: "#a0522d", side: "below" },
    { id: "land", label: "Land & Air Mobility", tickers: ["GD","TXT"], bc: "#8b7355", side: "below" },
    { id: "sea", label: "Naval Primes", tickers: ["HII"], bc: "#1e5f74", side: "below" },
  ]},
];

const NUCLEAR_SANKEY_STAGES = [
  { label: "Mining", groups: [
    { id: "miners", label: "Uranium Miners", tickers: ["CCJ","DNN","UEC","URG"], bc: "#a16207", side: "below" },
  ]},
  { label: "Fuel Cycle", groups: [
    { id: "conversion", label: "Conversion", tickers: ["CCJ","LEU"], bc: "#b8860b", side: "above" },
    { id: "enrichment", label: "Enrichment", tickers: ["LEU","CCJ"], bc: "#b8860b", side: "below" },
  ]},
  { label: "Reactors", groups: [
    { id: "smr", label: "SMR Developers", tickers: ["OKLO","SMR","NNE"], bc: "#50B8D8", side: "above" },
    { id: "epc", label: "Engineering / EPC", tickers: ["BWXT","FLR"], bc: "#8e44ad", side: "below" },
  ]},
  { label: "Utilities", groups: [
    { id: "merchant", label: "Merchant Utilities", tickers: ["CEG","VST"], bc: "#2a9a70", side: "above" },
    { id: "regulated", label: "Regulated Utilities", tickers: ["D","SO"], bc: "#2a9a70", side: "below" },
  ]},
  { label: "Offtake", groups: [
    { id: "ai_dc", label: "AI Datacenters", tickers: ["AMZN","MSFT","GOOG","META"], bc: "#CDA24E", side: "above" },
    { id: "grid", label: "Grid / Industrial", tickers: ["D","SO","NRG"], bc: "#40b070", side: "below" },
  ]},
];

const DRONES_SANKEY_STAGES = [
  { label: "Components", groups: [
    { id: "silicon", label: "Silicon & Control", tickers: ["NVDA","ADI","CRDO"], bc: "#5E94E8", side: "above" },
    { id: "parts", label: "Propulsion & Parts", tickers: ["HEI","TDG"], bc: "#a0522d", side: "below" },
  ]},
  { label: "Makers", groups: [
    { id: "tactical", label: "Tactical UAS", tickers: ["AVAV","RCAT","AIRO"], bc: "#5b8c2a", side: "above" },
    { id: "ccav", label: "Combat UAS", tickers: ["KTOS"], bc: "#556b2f", side: "below" },
    { id: "counter", label: "Counter-UAS & Surveil", tickers: ["ONDS","PDYN","UMAC"], bc: "#8e44ad", side: "below" },
  ]},
  { label: "Primes", groups: [
    { id: "primes", label: "Defense Primes", tickers: ["LMT","NOC","RTX","LHX"], bc: "#556b2f", side: "above" },
  ]},
];

const SPACE_SANKEY_STAGES = [
  { label: "Propulsion & Parts", groups: [
    { id: "propulsion", label: "Propulsion & Structures", tickers: ["AJRD","ROK","HEI"], bc: "#a0522d", side: "below" },
  ]},
  { label: "Launch", groups: [
    { id: "launch", label: "Launch Providers", tickers: ["RKLB"], bc: "#c44040", side: "above" },
  ]},
  { label: "Payloads", groups: [
    { id: "constellations", label: "Constellations", tickers: ["ASTS","IRDM"], bc: "#4872d8", side: "above" },
    { id: "eo", label: "EO / SAR", tickers: ["PL","SPIR","BKSY","MAXR"], bc: "#50B8D8", side: "below" },
  ]},
  { label: "Ground & Primes", groups: [
    { id: "primes", label: "Primes & Integrators", tickers: ["LMT","NOC","LHX"], bc: "#556b2f", side: "above" },
  ]},
];

const ROBOTICS_SANKEY_STAGES = [
  { label: "Silicon & Vision", groups: [
    { id: "silicon", label: "Silicon & AI", tickers: ["NVDA","ADI","TER"], bc: "#5E94E8", side: "above" },
  ]},
  { label: "Motion Components", groups: [
    { id: "actuators", label: "Motors & Actuators", tickers: ["ROK","EMR","ABBNY"], bc: "#a0522d", side: "below" },
  ]},
  { label: "Systems", groups: [
    { id: "humanoid", label: "Humanoid", tickers: ["TSLA","KSCP"], bc: "#d86840", side: "above" },
    { id: "industrial", label: "Industrial / Surgical", tickers: ["FANUY","ABBNY","ISRG"], bc: "#5E94E8", side: "below" },
    { id: "logistics", label: "Logistics / Warehouse", tickers: ["SYM","ZBRA"], bc: "#50B8D8", side: "below" },
  ]},
];

const QUANTUM_SANKEY_STAGES = [
  { label: "Enablers", groups: [
    { id: "gpu", label: "Classical GPU / HPC", tickers: ["NVDA","AMD"], bc: "#CDA24E", side: "above" },
  ]},
  { label: "Hardware", groups: [
    { id: "pureplay", label: "Pure-Play Quantum", tickers: ["IONQ","RGTI","QBTS","QUBT"], bc: "#8e44ad", side: "above" },
    { id: "bigtech", label: "Tech Giants (quantum)", tickers: ["IBM","HON","GOOG","MSFT"], bc: "#5E94E8", side: "below" },
  ]},
  { label: "Integration", groups: [
    { id: "consulting", label: "Consulting / Integration", tickers: ["BAH"], bc: "#c44040", side: "above" },
  ]},
];

const BIOTECH_SANKEY_STAGES = [
  { label: "Next-Gen Pipeline", groups: [
    { id: "next_gen", label: "Next-Gen Biotechs", tickers: ["VKTX","ALT","TERN"], bc: "#c44040", side: "above" },
  ]},
  { label: "CDMO", groups: [
    { id: "cdmo", label: "CDMO / Manufacturing", tickers: ["CTLT","LNZA","RGEN"], bc: "#1a8a5c", side: "below" },
  ]},
  { label: "Incumbents", groups: [
    { id: "incumbents", label: "GLP-1 Incumbents", tickers: ["LLY","NVO","AMGN"], bc: "#e74c3c", side: "above" },
  ]},
  { label: "Delivery", groups: [
    { id: "devices", label: "Devices / Delivery", tickers: ["BDX","WST"], bc: "#5E94E8", side: "below" },
  ]},
];

const BATTERIES_SANKEY_STAGES = [
  { label: "Materials", groups: [
    { id: "materials", label: "Raw Materials", tickers: ["ALB","PLL","MP"], bc: "#a0522d", side: "below" },
  ]},
  { label: "Cells", groups: [
    { id: "cells", label: "Cell Makers", tickers: ["TSLA","LGEM","CATL"], bc: "#b8860b", side: "above" },
  ]},
  { label: "Integration", groups: [
    { id: "utility_bess", label: "Utility BESS", tickers: ["FLNC","STEM"], bc: "#CDA24E", side: "above" },
    { id: "residential", label: "Residential / C&I", tickers: ["ENPH","SEDG"], bc: "#2a9a70", side: "below" },
  ]},
  { label: "End Markets", groups: [
    { id: "grid", label: "Grid Storage", tickers: ["FLNC","STEM","BE"], bc: "#2a9a70", side: "above" },
    { id: "solar", label: "Solar + Storage", tickers: ["FSLR","ENPH"], bc: "#b8860b", side: "below" },
  ]},
];

const URANIUM_SANKEY_STAGES = [
  { label: "Miners", groups: [
    { id: "miners", label: "Uranium Miners", tickers: ["CCJ","NXE","UEC","DNN","URG","UUUU"], bc: "#a16207", side: "below" },
  ]},
  { label: "Fuel Cycle", groups: [
    { id: "enrichment", label: "Enrichment / HALEU", tickers: ["LEU"], bc: "#b8860b", side: "above" },
  ]},
  { label: "Adjacent Materials", groups: [
    { id: "ree_li", label: "Rare Earths / Lithium", tickers: ["MP","LAC","ALB"], bc: "#CDA24E", side: "below" },
  ]},
  { label: "Vehicles", groups: [
    { id: "holding", label: "Royalty / ETFs", tickers: ["URA","SPUT"], bc: "#8b7355", side: "above" },
  ]},
];

const CRYPTO_SANKEY_STAGES = [
  { label: "Hardware", groups: [
    { id: "power", label: "Power & Hosting", tickers: ["CORZ","APLD"], bc: "#40b070", side: "above" },
  ]},
  { label: "Miners", groups: [
    { id: "scaled", label: "Scaled BTC Miners", tickers: ["MARA","RIOT","CLSK","HUT","BITF"], bc: "#f9a825", side: "above" },
  ]},
  { label: "Onramps", groups: [
    { id: "exchanges", label: "Exchanges & Brokers", tickers: ["COIN","HOOD"], bc: "#50B8D8", side: "below" },
  ]},
  { label: "Treasuries", groups: [
    { id: "btc_treasury", label: "BTC Treasuries", tickers: ["MSTR","SMLR"], bc: "#2a9a70", side: "above" },
  ]},
];

// AI theme — macro sensitivity axes (matches ms keys on each company)
const AI_MACRO = [
  { k: "ta", n: "Tariffs" },
  { k: "ch", n: "China" },
  { k: "ai", n: "AI Capex" },
  { k: "ra", n: "Rates" },
];

/* ────── Theme registry: 11 themes + 4 meta-themes ────── */
const THEMES = {
  ai: {
    id: "ai",
    title: "The AI Trade",
    subtitle: "AI Infrastructure · Full Ecosystem",
    accent: "#CDA24E",
    icon: "◆",
    verticals: AI_VERTICALS,
    macro: AI_MACRO,
    positions: AI_POSITIONS,
    zoneLabels: AI_ZONE_LABELS,
    sankey: AI_SANKEY_STAGES,
    available: true,
  },
  drones: {
    id: "drones",
    title: "The Drone Economy",
    subtitle: "Unmanned Aerial Systems · Defense & Commercial",
    accent: "#5b8c2a",
    icon: "▲",
    verticals: {
      loitering:   { n: "Loitering Munitions", c: "#c44040", bg: "rgba(196,64,64,.08)",   subs: ["Tactical","Long-range"] },
      tactical:    { n: "Tactical UAS", c: "#5b8c2a", bg: "rgba(91,140,42,.08)",          subs: ["Small","Medium","Recon","Cargo"] },
      combat:      { n: "Combat Drones (CCA)", c: "#556b2f", bg: "rgba(85,107,47,.08)",   subs: ["UCAV","Attritable","Naval"] },
      evtol:       { n: "Air Mobility (eVTOL)", c: "#4872d8", bg: "rgba(72,114,216,.08)", subs: ["Air Taxi","Cargo eVTOL","Vertiport"] },
      counter:     { n: "Counter-UAS", c: "#8e44ad", bg: "rgba(142,68,173,.08)",          subs: ["RF","Kinetic","Laser","Drone-on-Drone"] },
      components:  { n: "Propulsion & Parts", c: "#a0522d", bg: "rgba(160,82,45,.08)",    subs: ["Motors","Batteries","Airframe","Actuators"] },
      vision:      { n: "Sensors & Vision", c: "#b8860b", bg: "rgba(184,134,11,.08)",     subs: ["Lidar","EO/IR","Vision SoCs"] },
      software:    { n: "Autonomy & C2", c: "#5E94E8", bg: "rgba(94,148,232,.08)",        subs: ["Autonomy","AI","Swarm"] },
    },
    macro: [{ k: "df", n: "Defense Budget" }, { k: "re", n: "FAA Regulation" }, { k: "cn", n: "China / DJI" }, { k: "cf", n: "Conflicts" }],
    positions: {
      AVAV:[100,70], KTOS:[230,65], ONDS:[360,75], RCAT:[490,72], AIRO:[610,70], UMAC:[730,72], PDYN:[850,68],
      JOBY:[100,165], ACHR:[230,170], EH:[360,168], BLDE:[490,170], EVTL:[610,165], EVEX:[730,170],
      LMT:[100,255], NOC:[240,258], RTX:[380,252], BA:[510,258], TXT:[640,255], GD:[770,258],
      LHX:[100,345], MRCY:[230,348], TDG:[360,350], HEI:[490,348], TDY:[610,345],
      DRSHF:[100,435], ESLT:[230,438], MOG_A:[360,435],
      AMBA:[100,525], OUST:[230,525], INVZ:[360,525], LAZR:[490,525], HSAI:[610,525],
      ADI:[100,615], MCHP:[230,615], NVDA:[360,615], CRDO:[490,615],
    },
    zoneLabels: [
      [6, 80, "Pure-play military drone makers"],
      [6, 170, "Air mobility (eVTOL)"],
      [6, 260, "Large defense primes"],
      [6, 350, "Defense electronics + sensors"],
      [6, 435, "Counter-UAS + intl primes"],
      [6, 525, "Vision & lidar"],
      [6, 615, "Silicon & connectivity"],
    ],
    sankey: DRONES_SANKEY_STAGES,
    available: true,
  },
  space: {
    id: "space",
    title: "Space & Orbital",
    subtitle: "Launch · Satellites · Ground · Intelligence",
    accent: "#4872d8",
    icon: "★",
    verticals: {
      launch:     { n: "Launch", c: "#c44040", bg: "rgba(196,64,64,.08)",      subs: ["Small-lift","Medium","Reusable"] },
      satellites: { n: "Satellites & Comms", c: "#4872d8", bg: "rgba(72,114,216,.08)", subs: ["LEO Constellation","GEO","D2D","Broadband"] },
      eo_sar:     { n: "Earth Observation", c: "#50B8D8", bg: "rgba(80,184,216,.08)", subs: ["EO","SAR","Hyperspectral"] },
      ground:     { n: "Ground & Integrators", c: "#8e44ad", bg: "rgba(142,68,173,.08)", subs: ["Prime","Subsystems","Antennas"] },
      components: { n: "Components & Propulsion", c: "#a0522d", bg: "rgba(160,82,45,.08)", subs: ["Propulsion","Payloads","Structures","Actuators","Electronics"] },
      materials:  { n: "Aerospace Materials", c: "#6b8e23", bg: "rgba(107,142,35,.08)", subs: ["Composites","Titanium","Alloys","Superalloys"] },
    },
    macro: [{ k: "do", n: "DoD Funding" }, { k: "lc", n: "Launch Cadence" }, { k: "cm", n: "Commercial Capex" }, { k: "ra", n: "Rates" }],
    positions: {
      // T1 (Y=360): Aerospace materials
      HXL:[160,360], HWM:[270,360], ATI:[380,360], CRS:[490,360],

      // T2 (Y=310): Propulsion & components (crowded — 11 names, spread wide)
      RYCEY:[60,310], SAFRY:[140,310], MHVYF:[220,310], WWD:[295,310], PH:[360,310],
      AJRD:[425,310], DCO:[490,310], TGI:[548,310], RDW:[605,310],
      KRMN:[110,335], ROK:[200,335],

      // T3 (Y=255): Electronics
      TDG:[90,255], LHX:[180,255], HEI:[270,255], TDY:[360,255], CW:[450,255], MRCY:[540,255], "MOG.A":[620,255],

      // T4 (Y=200): Launch + emerging
      RKLB:[110,200], FLY:[220,200], SPCE:[330,200], KTOS:[440,200], BWXT:[550,200],

      // T5 (Y=150): Defense primes (ULA + space divisions)
      BA:[90,150], LMT:[200,150], NOC:[310,150], GD:[420,150], BAESY:[530,150],

      // T6 (Y=95): Commercial aero + sat manufacturers
      EADSY:[60,95], THLLY:[165,95], CAE:[265,95], ERJ:[360,95], LUNR:[450,95], VOYG:[540,95],

      // T7 (Y=45): Satellite operators + EO/SAR
      IRDM:[55,45], SATS:[130,45], VSAT:[205,45], GSAT:[280,45], ASTS:[355,45],
      MAXR:[430,45], PL:[495,45], BKSY:[555,45], SPIR:[615,45],

      // T8 (Y=12): Services / integrators
      LDOS:[220,12], SAIC:[420,12],
    },
    zoneLabels: [
      [6, 370, "Aerospace materials"],
      [6, 320, "Propulsion & components"],
      [6, 265, "Electronics & sensors"],
      [6, 210, "Launch & emerging"],
      [6, 160, "Defense primes"],
      [6, 105, "Commercial aero & sat manufacturers"],
      [6, 55,  "Operators + EO/SAR"],
      [6, 18,  "Services & integrators"],
    ],
    sankey: SPACE_SANKEY_STAGES,
    available: true,
  },
  defense: {
    id: "defense",
    title: "Defense Primes",
    subtitle: "Platforms · Munitions · Electronics · Services",
    accent: "#556b2f",
    icon: "⬢",
    verticals: {
      primes:      { n: "Prime Integrators", c: "#556b2f", bg: "rgba(85,107,47,.08)",   subs: ["Air","Sea","Land","Space"] },
      missiles:    { n: "Missiles & Munitions", c: "#a0522d", bg: "rgba(160,82,45,.08)", subs: ["Missiles","Munitions","Loitering"] },
      electronics: { n: "Defense Electronics", c: "#5E94E8", bg: "rgba(94,148,232,.08)", subs: ["Radar","EW","C4ISR","Sensors"] },
      services:    { n: "Services & IT", c: "#8e44ad", bg: "rgba(142,68,173,.08)",       subs: ["Analytics","IT","Engineering"] },
      shipbuilding:{ n: "Shipbuilding", c: "#1e5f74", bg: "rgba(30,95,116,.08)",         subs: ["Naval","Submarines"] },
      emerging:    { n: "Emerging & Unmanned", c: "#c44040", bg: "rgba(196,64,64,.08)",  subs: ["Unmanned","Autonomy","Space Defense"] },
    },
    macro: [{ k: "bg", n: "Defense Budget" }, { k: "cf", n: "Conflicts" }, { k: "ex", n: "FMS Exports" }, { k: "ra", n: "Rates" }],
    positions: {
      LMT:[90,60], NOC:[200,55], RTX:[330,58], GD:[440,62], BA:[540,55], HII:[620,65],
      LHX:[80,140], MRCY:[180,135], CW:[270,140], KTOS:[360,140], CUB:[450,145], TXT:[550,140],
      LDOS:[90,220], BAH:[190,225], CACI:[290,220], SAIC:[390,222], PLTR:[490,218],
      AVAV:[130,305], RKLB:[270,302], BWXT:[400,305], HEI:[530,308], TDG:[620,305],
    },
    zoneLabels: [
      [6, 70, "Prime contractors"],
      [6, 150, "Electronics & sensors"],
      [6, 230, "Services & IT"],
      [6, 315, "Emerging & unmanned"],
    ],
    sankey: DEFENSE_SANKEY_STAGES,
    available: true,
  },
  robotics: {
    id: "robotics",
    title: "Robotics & Automation",
    subtitle: "Humanoid · Industrial · Logistics",
    accent: "#d86840",
    icon: "⬡",
    verticals: {
      humanoid:    { n: "Humanoid Robots", c: "#d86840", bg: "rgba(216,104,64,.08)",    subs: ["Bipedal","Dexterous","Quadruped"] },
      industrial:  { n: "Industrial Automation", c: "#5E94E8", bg: "rgba(94,148,232,.08)", subs: ["Arms","PLC","Cobots"] },
      logistics:   { n: "Warehouse & Logistics", c: "#50B8D8", bg: "rgba(80,184,216,.08)", subs: ["AMR","Picking","Sortation","Forklifts"] },
      surgical:    { n: "Surgical Robotics", c: "#c44040", bg: "rgba(196,64,64,.08)",    subs: ["Soft Tissue","Orthopedic","Spinal","Specialty"] },
      vision:      { n: "Machine Vision & Sensors", c: "#b8860b", bg: "rgba(184,134,11,.08)", subs: ["Vision","Lidar","Sensors"] },
      components:  { n: "Motion Components", c: "#a0522d", bg: "rgba(160,82,45,.08)",     subs: ["Actuators","Encoders","Drives","Bearings"] },
      software:    { n: "Autonomy Software", c: "#8e44ad", bg: "rgba(142,68,173,.08)",    subs: ["Autonomy","Simulation","RPA"] },
    },
    macro: [{ k: "la", n: "Labor Costs" }, { k: "ai", n: "AI Progress" }, { k: "mfg", n: "Manufacturing" }, { k: "ra", n: "Rates" }],
    positions: {
      // T1 (Y=355): Silicon & software enablers
      NVDA:[140,355], ADI:[260,355], MCHP:[380,355], TER:[500,355],

      // T2 (Y=305): Sensors & vision (8 names — spread wide)
      KYCCF:[50,305], AME:[130,305], CGNX:[210,305], HSAI:[290,305],
      AMBA:[365,305], OUST:[440,305], LAZR:[510,305], INVZ:[580,305],

      // T3 (Y=250): Motion & components
      ROK:[165,250], NOVT:[320,250], HSCDY:[475,250],

      // T4 (Y=195): Industrial robots (7 Japanese/European/US names)
      FANUY:[55,195], YASKY:[150,195], ABBNY:[240,195], SIEGY:[330,195],
      SBGSY:[420,195], EMR:[510,195], OMRNY:[600,195],

      // T5 (Y=145): Surgical / medical
      ISRG:[90,145], SYK:[200,145], MDT:[310,145], GMED:[420,145], PRCT:[530,145],

      // T6 (Y=95): Logistics & AMRs
      SYM:[100,95], ZBRA:[220,95], KIOGY:[340,95], SERV:[460,95], AMZN:[580,95],

      // T7 (Y=48): Humanoids
      TSLA:[110,48], XPEV:[260,48], RR:[410,48], KSCP:[555,48],

    },
    zoneLabels: [
      [6, 365, "Silicon & software enablers"],
      [6, 315, "Sensors & vision"],
      [6, 260, "Motion control & components"],
      [6, 205, "Industrial robots"],
      [6, 155, "Surgical & medical"],
      [6, 105, "Logistics / AMRs"],
      [6, 58,  "Humanoids"],
    ],
    sankey: ROBOTICS_SANKEY_STAGES,
    available: true,
  },
  nuclear: {
    id: "nuclear",
    title: "Nuclear Renaissance",
    subtitle: "Utilities · SMR · Fuel Cycle",
    accent: "#2a9a70",
    icon: "☢",
    verticals: {
      utilities:  { n: "Nuclear Utilities", c: "#2a9a70", bg: "rgba(42,154,112,.08)",   subs: ["Merchant","Regulated","IPP"] },
      smr:        { n: "SMR Developers", c: "#50B8D8", bg: "rgba(80,184,216,.08)",      subs: ["SMR","Microreactor","Advanced"] },
      enrichment: { n: "Fuel & Enrichment", c: "#b8860b", bg: "rgba(184,134,11,.08)",   subs: ["Enrichment","Conversion","Fabrication"] },
      miners:     { n: "Uranium Miners", c: "#a16207", bg: "rgba(161,98,7,.08)",        subs: ["Producer","Developer","Explorer"] },
      services:   { n: "Engineering & Services", c: "#8e44ad", bg: "rgba(142,68,173,.08)", subs: ["EPC","Services","Parts"] },
    },
    macro: [{ k: "pp", n: "Power Prices" }, { k: "pl", n: "Policy" }, { k: "ur", n: "Uranium" }, { k: "ai", n: "AI DC Demand" }],
    positions: {
      // T1 (Y=355): Miners — raw fuel input
      CCJ:[90,355], UEC:[200,355], NXE:[310,355], DNN:[420,355], URG:[530,355],

      // T2 (Y=305): Enrichment & fuel tech
      LEU:[130,305], ASPI:[290,305], LTBR:[440,305],

      // T3 (Y=250): Components & fuel fabrication
      BWXT:[80,250], CW:[185,250], HWM:[290,250], ATI:[395,250], RYCEY:[500,250], MHVYF:[605,250],

      // T4 (Y=195): SMR developers + large reactor OEMs
      OKLO:[110,195], SMR:[230,195], NNE:[340,195], GEV:[460,195],

      // T5 (Y=145): Services & safety monitoring
      MIR:[110,145], PWR:[250,145], FLR:[385,145], J:[510,145],

      // T6 (Y=80): Utilities — nuclear fleet operators
      NEE:[55,80], SO:[125,80], DUK:[195,80], CEG:[265,80], VST:[335,80], D:[405,80], TLN:[475,80],
      PEG:[80,108], XEL:[160,108], EXC:[240,108], NRG:[320,108], CMS:[400,108], DTE:[480,108],

      // T7 (Y=25): Hyperscaler offtakers
      GOOG:[150,25], MSFT:[290,25], AMZN:[430,25], META:[560,25],
    },
    zoneLabels: [
      [6, 365, "Uranium miners"],
      [6, 315, "Enrichment & fuel tech"],
      [6, 260, "Components & fuel fabrication"],
      [6, 205, "SMR & reactor OEMs"],
      [6, 155, "Services & monitoring"],
      [6, 90,  "Nuclear utilities"],
      [6, 35,  "Hyperscaler offtakers"],
    ],
    sankey: NUCLEAR_SANKEY_STAGES,
    available: true,
  },
  quantum: {
    id: "quantum",
    title: "Quantum Computing",
    subtitle: "Hardware · Software · Post-Quantum Crypto",
    accent: "#8e44ad",
    icon: "⚛",
    verticals: {
      hardware:    { n: "Quantum Hardware", c: "#8e44ad", bg: "rgba(142,68,173,.08)",    subs: ["Superconducting","Trapped Ion","Photonic","Neutral Atom"] },
      enablers:    { n: "Picks & Shovels", c: "#a16207", bg: "rgba(161,98,7,.08)",       subs: ["Cryostats","Lasers/Photonics","Foundry","Test/Measure","Silicon"] },
      software:    { n: "Quantum Software", c: "#5E94E8", bg: "rgba(94,148,232,.08)",    subs: ["SDK","Algorithms","Optimization"] },
      compute:     { n: "Classical GPU/HPC", c: "#CDA24E", bg: "rgba(205,162,78,.08)",   subs: ["HPC","GPU","Hybrid"] },
      hyperscaler: { n: "Cloud / Quantum Cloud", c: "#4872d8", bg: "rgba(72,114,216,.08)", subs: ["Azure Quantum","Braket","Google QAI"] },
      security:    { n: "Post-Quantum Crypto", c: "#c44040", bg: "rgba(196,64,64,.08)",  subs: ["PQC","Encryption","Quantum Safe"] },
      services:    { n: "Consulting & Integration", c: "#2a9a70", bg: "rgba(42,154,112,.08)", subs: ["Consulting","Federal","Integration"] },
    },
    macro: [{ k: "rd", n: "R&D Funding" }, { k: "eg", n: "Err Correction" }, { k: "cl", n: "Cloud Integration" }, { k: "ra", n: "Rates" }],
    positions: {
      IONQ:[100,70], RGTI:[210,72], QBTS:[320,70], QUBT:[430,72], INFQ:[540,70], XANM:[640,72],
      IBM:[110,170], HON:[230,172], GOOG:[350,168], MSFT:[470,170], AMZN:[590,172], INTC:[710,170],
      OXIGY:[100,260], MKSI:[210,262], COHR:[320,260], SKYT:[430,262], CIEN:[540,260], ATOM:[640,262],
      NVDA:[110,355], AMD:[240,355],
      ARQQ:[100,445], LAES:[210,445], PANW:[320,445], CRWD:[430,445], NET:[540,445], VRSN:[640,445],
      BAH:[100,535], RTX:[210,535], BAESY:[320,535],
    },
    zoneLabels: [
      [6, 80, "Pure-play quantum hardware"],
      [6, 175, "Tech giants with quantum programs"],
      [6, 265, "Picks & shovels (cryostats, lasers, foundry)"],
      [6, 355, "GPU / HPC enablers"],
      [6, 445, "Post-quantum cryptography & security"],
      [6, 535, "Consulting & defense quantum"],
    ],
    sankey: QUANTUM_SANKEY_STAGES,
    available: true,
  },
  // ═══════════════════════════════════════════════════════════════
  // META-THEMES — pre-packaged combinations of constituent themes.
  // Each has a `verticalMapper` function that maps a company's native
  // vertical (co.v) to a meta-theme vertical for grouping.
  // ═══════════════════════════════════════════════════════════════
  aerospace_defense: {
    id: "aerospace_defense",
    title: "Aerospace & Defense",
    subtitle: "Space · Defense · Drones · Aerospace Stack",
    accent: "#556b2f",
    icon: "⚔",
    meta: true,
    constituentThemes: ["space", "defense", "drones"],
    verticals: {
      primes:      { n: "Primes & Integrators", c: "#556b2f", bg: "rgba(85,107,47,.08)",    subs: ["Air","Land","Sea","International"] },
      space:       { n: "Space & Satellites",   c: "#4872d8", bg: "rgba(72,114,216,.08)",   subs: ["Launch","Satellites","EO/SAR","Ground"] },
      drones:      { n: "Drones & UAS",         c: "#5b8c2a", bg: "rgba(91,140,42,.08)",    subs: ["Tactical","Loitering","CCA","Counter-UAS","eVTOL"] },
      electronics: { n: "Electronics & Sensors",c: "#CDA24E", bg: "rgba(205,162,78,.08)",   subs: ["C4ISR","Sensors","Vision","EW"] },
      materials:   { n: "Aerospace Materials",  c: "#6b8e23", bg: "rgba(107,142,35,.08)",   subs: ["Composites","Titanium","Superalloys"] },
      services:    { n: "Services & Emerging",  c: "#8e44ad", bg: "rgba(142,68,173,.08)",   subs: ["Federal IT","EPC","Pure-plays"] },
    },
    macro: [{ k: "df", n: "Defense Budget" }, { k: "lc", n: "Launch Cadence" }, { k: "cf", n: "Conflicts" }, { k: "ra", n: "Rates" }],
    verticalMapper: (co) => {
      const v = co.v;
      if (["launch","satellites","eo_sar","ground"].includes(v)) return "space";
      if (["loitering","tactical","combat","counter","evtol"].includes(v)) return "drones";
      if (v === "vision") return "electronics";
      if (v === "electronics") return "electronics";
      if (["primes","air","land","missiles"].includes(v)) return "primes";
      if (v === "materials") return "materials";
      if (v === "services") return "services";
      if (v === "emerging") return "services";
      if (v === "components") {
        if ((co.themes || []).includes("space") || (co.themes || []).includes("defense")) return "electronics";
        return "services";
      }
      if (v === "software") return "electronics";
      return "services";
    },
    positions: {
      // T1 (Y=362): Aerospace materials — raw inputs
      HXL:[180,362], HWM:[300,362], ATI:[420,362], CRS:[540,362],

      // T2 (Y=312 + sub Y=337): Propulsion & components — 12 names
      RYCEY:[55,312], SAFRY:[125,312], MHVYF:[195,312],
      PH:[265,312], WWD:[325,312], KRMN:[385,312],
      AJRD:[445,312], RDW:[505,312], TGI:[560,312], "MOG.A":[615,312],
      MCHP:[160,337], ROK:[320,337], DCO:[480,337],

      // T3 (Y=258 + sub Y=283): Electronics + Vision/Sensors — 14 names
      TDG:[55,258], LHX:[115,258], HEI:[175,258], FINMY:[235,258],
      TDY:[295,258], ESLT:[355,258], CW:[415,258], CUB:[475,258], MRCY:[535,258],
      HSAI:[100,283], AMBA:[200,283], OUST:[300,283], LAZR:[400,283], INVZ:[500,283],

      // T4 (Y=210): Missiles · Launch · Emerging — 9 names
      RTX:[55,210], HII:[130,210], LASR:[205,210],
      RKLB:[285,210], FLY:[355,210], SPCE:[425,210],
      KTOS:[500,210], AVAV:[565,210], BWXT:[625,210],

      // T5 (Y=160): Defense primes — 8 names
      BA:[55,160], LMT:[135,160], NOC:[215,160], GD:[295,160],
      BAESY:[375,160], RNMBY:[455,160], TXT:[535,160], OSK:[615,160],

      // T6 (Y=110): Small drones + Counter-UAS + Autonomy SW — 9 names
      AIRO:[55,110], RCAT:[120,110], DPRO:[185,110], UAVS:[250,110],
      DRSHF:[335,110], ONDS:[400,110], UMAC:[465,110],
      PDYN:[545,110], ADI:[615,110],

      // T7 (Y=55 + sub Y=80): Commercial aero + Sat operators + EO — 15 names
      EADSY:[55,55], THLLY:[135,55], CAE:[215,55], ERJ:[295,55], LUNR:[375,55], VOYG:[455,55],
      ASTS:[55,80], SATS:[130,80], IRDM:[205,80], GSAT:[275,80], VSAT:[345,80],
      MAXR:[415,80], PL:[480,80], BKSY:[545,80], SPIR:[610,80],

      // T8 (Y=18 + sub Y=40): eVTOL · Integrators · Hyperscalers — 14 names
      JOBY:[55,18], ACHR:[125,18], EH:[195,18], EVEX:[265,18], BLDE:[335,18], EVTL:[405,18],
      PLTR:[55,40], LDOS:[125,40], BAH:[195,40], CACI:[265,40], SAIC:[335,40],
    },
    zoneLabels: [
      [6, 372, "Aerospace materials"],
      [6, 322, "Propulsion & components"],
      [6, 268, "Electronics & sensors"],
      [6, 220, "Missiles · Launch · Emerging"],
      [6, 170, "Defense primes"],
      [6, 120, "Small drones & counter-UAS"],
      [6, 65,  "Commercial aero · Sat operators · EO"],
      [6, 28,  "eVTOL · Integrators"],
    ],
    available: true,
  },
  physical_ai: {
    id: "physical_ai",
    title: "Physical AI",
    subtitle: "Robotics · Drones · Embodied Intelligence",
    accent: "#00a86b",
    icon: "🤖",
    meta: true,
    constituentThemes: ["robotics", "drones"],
    verticals: {
      humanoid:    { n: "Humanoids",            c: "#00a86b", bg: "rgba(0,168,107,.08)",    subs: ["Full-stack","Chinese","Emerging"] },
      industrial:  { n: "Industrial Robots",    c: "#5b8c2a", bg: "rgba(91,140,42,.08)",    subs: ["Arms","AMRs","Logistics","Motion"] },
      surgical:    { n: "Surgical & Medical",   c: "#c44040", bg: "rgba(196,64,64,.08)",    subs: ["Laparoscopic","Orthopedic","Specialty"] },
      drones:      { n: "Drones & eVTOL",       c: "#4872d8", bg: "rgba(72,114,216,.08)",   subs: ["Tactical","Loitering","Air Taxi"] },
      sensors:     { n: "Vision & Sensors",     c: "#b8860b", bg: "rgba(184,134,11,.08)",   subs: ["Lidar","Vision SoCs","EO/IR"] },
      silicon:     { n: "Silicon & Components", c: "#CDA24E", bg: "rgba(205,162,78,.08)",   subs: ["GPUs","Motion Chips","Actuators","Software"] },
      hyperscalers:{ n: "Cloud / Hyperscalers", c: "#4872d8", bg: "rgba(72,114,216,.08)",   subs: ["Embodied AI platforms"] },
    },
    macro: [{ k: "lc", n: "Labor Cost" }, { k: "cx", n: "Capex Cycle" }, { k: "df", n: "Defense Demand" }, { k: "ra", n: "Rates" }],
    verticalMapper: (co) => {
      const v = co.v;
      if (v === "humanoid") return "humanoid";
      if (v === "industrial" || v === "logistics") return "industrial";
      if (v === "surgical") return "surgical";
      if (["loitering","tactical","combat","counter","evtol"].includes(v)) return "drones";
      if (v === "vision") return "sensors";
      if (v === "hyperscaler") return "hyperscalers";
      if (v === "compute" || v === "components" || v === "software") return "silicon";
      return "silicon";
    },
    positions: {},
    zoneLabels: [],
    available: true,
  },
  ai_stack: {
    id: "ai_stack",
    title: "AI Infrastructure Stack",
    subtitle: "Compute · Quantum · Nuclear Power",
    accent: "#8e44ad",
    icon: "⚡",
    meta: true,
    constituentThemes: ["ai", "quantum", "nuclear"],
    verticals: {
      hyperscalers:     { n: "Hyperscalers",           c: "#4872d8", bg: "rgba(72,114,216,.08)",   subs: ["Cloud","AI Platforms"] },
      compute:          { n: "AI Compute",             c: "#CDA24E", bg: "rgba(205,162,78,.08)",   subs: ["GPUs","ASICs","Memory","Foundry"] },
      networking:       { n: "DC Networking",          c: "#5E94E8", bg: "rgba(94,148,232,.08)",   subs: ["Switching","Optics","Storage"] },
      quantum_hw:       { n: "Quantum Hardware",       c: "#8e44ad", bg: "rgba(142,68,173,.08)",   subs: ["Ion","Superconducting","Photonic","Atom"] },
      quantum_enablers: { n: "Quantum Enablers + PQC", c: "#a16207", bg: "rgba(161,98,7,.08)",     subs: ["Cryostats","Lasers","PQC"] },
      nuclear_power:    { n: "Nuclear Power",          c: "#2a9a70", bg: "rgba(42,154,112,.08)",   subs: ["Utilities","SMR","Fuel Cycle"] },
      picks_shovels:    { n: "Picks & Shovels",        c: "#a0522d", bg: "rgba(160,82,45,.08)",    subs: ["Components","Services","Materials"] },
    },
    macro: [{ k: "ai", n: "AI Capex" }, { k: "eg", n: "Energy Grid" }, { k: "rd", n: "Quantum R&D" }, { k: "ra", n: "Rates" }],
    verticalMapper: (co) => {
      const v = co.v;
      const themes = co.themes || [];
      if (v === "hyperscaler") return "hyperscalers";
      if (v === "compute" || v === "memory") return "compute";
      if (v === "networking" || v === "storage" || v === "photonics") return "networking";
      if (v === "hardware" && themes.includes("quantum")) return "quantum_hw";
      if (v === "enablers" && themes.includes("quantum")) return "quantum_enablers";
      if (v === "security" && themes.includes("quantum")) return "quantum_enablers";
      if (v === "software" && themes.includes("quantum")) return "quantum_enablers";
      if (v === "services" && themes.includes("quantum")) return "quantum_enablers";
      if (v === "utilities") return "nuclear_power";
      if (v === "smr") return "nuclear_power";
      if (v === "enrichment" || v === "miners") return "nuclear_power";
      if (themes.includes("nuclear") && ["services","components","electronics","emerging"].includes(v)) return "picks_shovels";
      return "compute";
    },
    positions: {},
    zoneLabels: [],
    available: true,
  },
  energy_transition: {
    id: "energy_transition",
    title: "Energy Transition",
    subtitle: "Nuclear · Uranium · Batteries",
    accent: "#4872d8",
    icon: "⚡",
    meta: true,
    constituentThemes: ["nuclear", "uranium", "batteries"],
    verticals: {
      nuclear_utilities: { n: "Nuclear Utilities",   c: "#2a9a70", bg: "rgba(42,154,112,.08)",   subs: ["Regulated","Merchant","IPP"] },
      smr:               { n: "SMR Developers",      c: "#556b2f", bg: "rgba(85,107,47,.08)",    subs: ["SMR","Microreactor","Advanced"] },
      uranium_miners:    { n: "Uranium Miners",      c: "#a16207", bg: "rgba(161,98,7,.08)",     subs: ["Producers","Developers","Explorers"] },
      battery_cells:     { n: "Battery Cells",       c: "#c44040", bg: "rgba(196,64,64,.08)",    subs: ["Li-ion","Solid State","Flow"] },
      battery_materials: { n: "Battery Materials",   c: "#a0522d", bg: "rgba(160,82,45,.08)",    subs: ["Lithium","Nickel","Cobalt","Graphite"] },
      fuel_cycle:        { n: "Fuel Cycle & Ancillary",c: "#8e44ad", bg: "rgba(142,68,173,.08)", subs: ["Enrichment","Conversion","Fabrication","Detection"] },
      picks_shovels:     { n: "Engineering & Services",c: "#CDA24E", bg: "rgba(205,162,78,.08)", subs: ["EPC","Components","Materials"] },
    },
    macro: [{ k: "eg", n: "Energy Grid" }, { k: "ra", n: "Rates" }, { k: "cf", n: "Geopolitics" }, { k: "ai", n: "AI Load" }],
    verticalMapper: (co) => {
      const v = co.v;
      const themes = co.themes || [];
      if (v === "utilities") return "nuclear_utilities";
      if (v === "smr") return "smr";
      if (v === "miners") return "uranium_miners";
      if (v === "enrichment") return "fuel_cycle";
      if (themes.includes("batteries")) {
        if (["cells","manufacturing"].includes(v)) return "battery_cells";
        if (["materials","mining"].includes(v)) return "battery_materials";
        return "battery_cells";
      }
      if (themes.includes("nuclear") && ["services","components","electronics","emerging"].includes(v)) return "picks_shovels";
      return "picks_shovels";
    },
    positions: {},
    zoneLabels: [],
    available: true,
  },
  // ═══════════════════════════════════════════════════════════════
  biotech: {
    id: "biotech",
    title: "Obesity & GLP-1",
    subtitle: "Incumbents · Oral · CDMO · Devices",
    accent: "#e74c3c",
    icon: "⚕",
    verticals: {
      incumbents: { n: "GLP-1 Incumbents", c: "#e74c3c", bg: "rgba(231,76,60,.08)",       subs: ["GLP-1/GIP","Injectable","Oral"] },
      next_gen:   { n: "Next-Gen Obesity", c: "#c44040", bg: "rgba(196,64,64,.08)",       subs: ["Amylin","Multi-agonist","Muscle-sparing"] },
      cdmo:       { n: "CDMO / Manufacturing", c: "#1a8a5c", bg: "rgba(26,138,92,.08)",   subs: ["Fill-finish","API","Bioreactor"] },
      devices:    { n: "Delivery & Devices", c: "#5E94E8", bg: "rgba(94,148,232,.08)",    subs: ["Pens","Autoinjectors"] },
      impacted:   { n: "Impacted Sectors", c: "#888", bg: "rgba(0,0,0,.04)",              subs: ["Food","Medical Devices","Renal","Sleep"] },
    },
    macro: [{ k: "mr", n: "Medicare Price" }, { k: "ip", n: "IRA / Pricing" }, { k: "ad", n: "Adoption" }, { k: "ra", n: "Rates" }],
    positions: {
      LLY:[100,72], NVO:[220,70], PFE:[340,72], RHHBY:[460,70], AMGN:[580,72],
      VKTX:[100,168], ALT:[220,170], TERN:[340,172], GPCR:[460,168], ZEAL:[580,170], AZN:[690,172],
      CTLT:[100,260], LNZA:[220,262], RGEN:[340,258],
      BDX:[100,350], WST:[220,355],
    },
    zoneLabels: [
      [6, 80, "GLP-1 incumbents (Lilly, Novo)"],
      [6, 175, "Next-gen obesity biotechs"],
      [6, 263, "CDMO & manufacturing partners"],
      [6, 355, "Devices & delivery systems"],
    ],
    sankey: BIOTECH_SANKEY_STAGES,
    available: true,
  },
  batteries: {
    id: "batteries",
    title: "Energy Storage",
    subtitle: "Cells · Pack · Utility · Grid",
    accent: "#b8860b",
    icon: "⚡",
    verticals: {
      cells:      { n: "Cell Makers", c: "#b8860b", bg: "rgba(184,134,11,.08)",          subs: ["Li-ion","LFP","Solid-state"] },
      integrators:{ n: "Storage Integrators", c: "#CDA24E", bg: "rgba(205,162,78,.08)",  subs: ["Utility BESS","C&I","Residential"] },
      materials:  { n: "Cathode / Anode Materials", c: "#a0522d", bg: "rgba(160,82,45,.08)", subs: ["Cathode","Anode","Electrolyte"] },
      automotive: { n: "Automotive Exposure", c: "#5E94E8", bg: "rgba(94,148,232,.08)",  subs: ["OEM","Packs"] },
      grid:       { n: "Grid & Inverters", c: "#2a9a70", bg: "rgba(42,154,112,.08)",     subs: ["Inverters","EMS","PCS"] },
    },
    macro: [{ k: "li", n: "Lithium Price" }, { k: "ev", n: "EV Demand" }, { k: "gr", n: "Grid Capex" }, { k: "cn", n: "China Tariffs" }],
    positions: {
      TSLA:[130,72], PANW_BAT:[280,70], LGEM:[420,68], CATL:[550,72],
      FLNC:[130,170], STEM:[280,172], BE:[420,168], NVEE:[550,170],
      ALB:[130,262], PLL:[280,258], MP:[420,262],
      ENPH:[130,352], SEDG:[280,355], FSLR:[420,352],
    },
    zoneLabels: [
      [6, 80, "Cell manufacturers"],
      [6, 175, "Storage integrators"],
      [6, 263, "Raw materials"],
      [6, 352, "Inverters & adjacent"],
    ],
    sankey: BATTERIES_SANKEY_STAGES,
    available: true,
  },
  uranium: {
    id: "uranium",
    title: "Uranium & Critical Minerals",
    subtitle: "Miners · Enrichment · Rare Earths",
    accent: "#a16207",
    icon: "⚒",
    verticals: {
      uranium:    { n: "Uranium Miners", c: "#a16207", bg: "rgba(161,98,7,.08)",         subs: ["Producer","Developer","Explorer"] },
      enrichment: { n: "Enrichment & Fuel", c: "#b8860b", bg: "rgba(184,134,11,.08)",    subs: ["Enrichment","Conversion","HALEU"] },
      rare_earths:{ n: "Rare Earths & Lithium", c: "#CDA24E", bg: "rgba(205,162,78,.08)", subs: ["REE","Lithium","Graphite"] },
      royalty:    { n: "Royalty / ETFs", c: "#8b7355", bg: "rgba(139,115,85,.08)",        subs: ["Royalty","Holding","ETF"] },
    },
    macro: [{ k: "up", n: "U3O8 Price" }, { k: "gp", n: "Geopolitics" }, { k: "pl", n: "Policy" }, { k: "dm", n: "Demand" }],
    positions: {
      CCJ:[130,75], KAP:[280,72], NXE:[420,75], UEC:[550,72], DNN:[680,75],
      PDN:[130,175], BOE:[280,175], URG:[420,175], LEU:[560,175], UUUU:[680,175],
      MP:[130,265], LAC:[280,262], ALB:[420,265],
      URA:[130,355], SPUT:[280,352],
    },
    zoneLabels: [
      [6, 85, "Uranium miners"],
      [6, 180, "Enrichment & fuel"],
      [6, 270, "Rare earths & lithium"],
      [6, 355, "Royalty & ETFs"],
    ],
    sankey: URANIUM_SANKEY_STAGES,
    available: true,
  },
  crypto: {
    id: "crypto",
    title: "Crypto Infrastructure",
    subtitle: "Mining · Exchanges · Stablecoins · Treasuries",
    accent: "#f9a825",
    icon: "◉",
    verticals: {
      miners:     { n: "BTC Miners", c: "#f9a825", bg: "rgba(249,168,37,.08)",           subs: ["Scaled","AI Pivot","Hosting"] },
      exchanges:  { n: "Exchanges & Brokers", c: "#50B8D8", bg: "rgba(80,184,216,.08)",  subs: ["Spot","Derivatives","Stablecoin"] },
      treasuries: { n: "BTC Treasuries", c: "#2a9a70", bg: "rgba(42,154,112,.08)",       subs: ["Pure Treasury","Operating"] },
      infra:      { n: "Infra & Custody", c: "#4872d8", bg: "rgba(72,114,216,.08)",      subs: ["Custody","Payments","Stablecoin Issuer"] },
      hardware:   { n: "Mining Hardware", c: "#a0522d", bg: "rgba(160,82,45,.08)",       subs: ["ASICs","Rigs"] },
    },
    macro: [{ k: "bt", n: "BTC Price" }, { k: "rg", n: "Regulation" }, { k: "in", n: "Institutional" }, { k: "ra", n: "Rates" }],
    positions: {
      MARA:[120,70], RIOT:[240,72], CLSK:[360,70], HUT:[480,72], BITF:[600,70],
      COIN:[120,165], HOOD:[260,168],
      MSTR:[120,260], SMLR:[260,258],
      GLXY:[120,352], CORZ:[260,355], APLD:[400,352],
    },
    zoneLabels: [
      [6, 80, "Bitcoin miners"],
      [6, 175, "Exchanges & brokers"],
      [6, 265, "BTC treasury companies"],
      [6, 355, "Custody & AI-pivoting miners"],
    ],
    sankey: CRYPTO_SANKEY_STAGES,
    available: true,
  },
};

const THEME_ORDER = ["ai", "aerospace_defense", "nuclear", "space", "robotics", "quantum"];
const META_THEME_IDS = new Set(["aerospace_defense", "physical_ai", "ai_stack", "energy_transition"]);

// Resolver: returns which vertical a company belongs to under a given theme.
// For meta-themes uses the theme's verticalMapper; for regular themes returns co.v.
function resolveCompanyVertical(co, theme) {
  if (theme && theme.meta && typeof theme.verticalMapper === "function") {
    try { return theme.verticalMapper(co); } catch { return co.v; }
  }
  return co.v;
}

// Company filter: for meta-themes, match ANY constituent theme. For regular themes, match the id.
function themeMatchesCompany(themeOrId, co) {
  const theme = typeof themeOrId === "string" ? THEMES[themeOrId] : themeOrId;
  if (!theme || !co.themes) return false;
  if (theme.meta && theme.constituentThemes) {
    return co.themes.some(t => theme.constituentThemes.includes(t));
  }
  return co.themes.includes(theme.id);
}

/* ═══════════════════════════════════════════════════════════════════════════
   ╔══════════════════════════════════════════════════════════════════════╗
   ║                         CODE SECTION                                  ║
   ║  Everything below is React components, data fetchers, and logic.     ║
   ║  You should not need to edit below unless changing behavior.         ║
   ╚══════════════════════════════════════════════════════════════════════╝
   ═══════════════════════════════════════════════════════════════════════════ */

// ───── SHARED STYLE CONSTANTS (module-level; used across multiple components) ─────
const FONT_SANS = "Arial, Helvetica, sans-serif";

// Standard "card" container used by MarketSummary rows, Detail subsections, etc.
const STYLE_CARD = {
  background: "#fff",
  border: "1px solid rgba(0,0,0,.06)",
  borderRadius: 10,
  boxShadow: "0 1px 3px rgba(0,0,0,.03)",
};

// Uppercase section label: "Price history", "Supply chain", etc.
const STYLE_LABEL = {
  fontSize: 11,
  fontWeight: 600,
  color: "#aaa",
  letterSpacing: 1.5,
  textTransform: "uppercase",
  marginBottom: 5,
};

// Dimmer variant used in MarketSummary row headers
const STYLE_LABEL_DIM = { ...STYLE_LABEL, color: "#999", marginBottom: 6 };

// Visual divider between Detail sections
const STYLE_SECTION = {
  borderTop: "1px solid rgba(0,0,0,.06)",
  paddingTop: 10,
  marginTop: 10,
};

// Deprecated aliases kept so scatter-reference sections that haven't been refactored yet still work.
// VX now merges verticals from ALL themes so any company's vertical resolves even when viewing another theme.
// MACRO stays pointing at the AI theme's axes (legacy fallback).
const VX = new Proxy({}, {
  get(target, prop) {
    // Check every theme's verticals dict for this key
    for (const tid of Object.keys(THEMES)) {
      const v = THEMES[tid]?.verticals?.[prop];
      if (v) return v;
    }
    return undefined;
  },
  has(target, prop) {
    for (const tid of Object.keys(THEMES)) {
      if (THEMES[tid]?.verticals?.[prop]) return true;
    }
    return false;
  },
  ownKeys() {
    const keys = new Set();
    for (const tid of Object.keys(THEMES)) {
      const vs = THEMES[tid]?.verticals;
      if (vs) Object.keys(vs).forEach(k => keys.add(k));
    }
    return Array.from(keys);
  },
  getOwnPropertyDescriptor(target, prop) {
    for (const tid of Object.keys(THEMES)) {
      const v = THEMES[tid]?.verticals?.[prop];
      if (v) return { enumerable: true, configurable: true, value: v };
    }
    return undefined;
  },
});
const MACRO = AI_MACRO;

function Logo({ ticker, size = 16, style = {} }) {
  const b = BRAND[ticker] || ["#888", ticker?.slice(0,2) || "?"];
  const fs = size <= 12 ? 6 : size <= 16 ? 7 : size <= 20 ? 8 : size <= 24 ? 10 : 11;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: size, height: size, borderRadius: size > 20 ? "50%" : 3, flexShrink: 0,
      background: b[0], color: "#fff", fontSize: fs, fontWeight: 700, lineHeight: 1, verticalAlign: "middle",
      ...style,
    }}>{b[1]}</span>
  );
}

/* ════════════════════════ LIVE DATA FETCHER ════════════════════════ */
const QUOTE_BATCH_SIZE = 120;

async function fetchResearchStatus() {
  try {
    return await getResearchStatusRequest();
  } catch (e) {
    return { configured: false, provider: null };
  }
}

async function fetchQuotes(tickers) {
  const results = {};
  const uniqueTickers = [...new Set(tickers.map(t => String(t || "").trim().toUpperCase()).filter(Boolean))];

  for (let i = 0; i < uniqueTickers.length; i += QUOTE_BATCH_SIZE) {
    const batch = uniqueTickers.slice(i, i + QUOTE_BATCH_SIZE);

    try {
      const payload = await getQuoteSnapshotsRequest({
        symbols: batch.join(","),
      });
      const quotes = Array.isArray(payload?.quotes) ? payload.quotes : [];

      quotes.forEach(q => {
        const internalTicker = FMP_REVERSE[q.symbol] || q.symbol;
        results[internalTicker] = {
          price: q.price,
          bid: q.bid,
          ask: q.ask,
          change: q.change,
          changePct: q.changePercent,
        };
      });
    } catch (e) {}
  }

  return results;
}

// Module-level cache for historical data: Map<ticker, {hist: [...], fetchedAt: ms, days: N}>
const histCache = new Map();
const HIST_CACHE_MS = 15 * 60 * 1000; // 15 minutes

// Module-level cache for fundamental ratios: Map<ticker, {data: {...}, fetchedAt: ms}>
// Fetches /ratios-ttm + /key-metrics-ttm + /profile (the last gives us live beta).
// These endpoints are single-ticker, so fetchFund is lazy — called per company on Detail open.
const fundCache = new Map();
const FUND_CACHE_MS = 24 * 60 * 60 * 1000; // 24 hours

async function fetchFund(ticker) {
  if (!ticker) return null;
  const cached = fundCache.get(ticker);
  if (cached && (Date.now() - cached.fetchedAt) < FUND_CACHE_MS) return cached.data;

  try {
    const payload = await getResearchFundamentalsRequest({ symbol: ticker });
    const data = payload?.fundamentals || null;

    if (!data) return null;

    fundCache.set(ticker, { data, fetchedAt: Date.now() });
    return data;
  } catch (e) {
    return null;
  }
}

// Background prefetch: after initial app load, silently fetch TTM fundamentals for every
// enriched company so peer tables and detail panels always show fresh data (not authored fallback).
// Uses a bounded concurrency queue to avoid hammering the free-tier FMP rate limit (300 req/min).
// onProgress called with {done, total} after each completion for optional UI indicator.
async function backgroundPrefetchFundamentals() {
  return;
}

// Bulk prefetch of 1-hour intraday bars for ALL equities.
// Populates histCache with key `ticker|1hour` — covers last ~30 trading days at hourly resolution.
// Enables sparklines in PeerTable, instant 1M loads in Detail panel, momentum screens.
async function backgroundPrefetchHist() {
  return;
}

// Module-level cache for earnings calendar — single fetch covers all tickers in a date range.
// Cache for 1 hour; calendar entries can shift as companies announce/reschedule.
let earningsCalCache = null; // { data: [...], fetchedAt: ms, from, to }
const EARNINGS_CAL_CACHE_MS = 60 * 60 * 1000;

async function fetchEarningsCalendar(from, to) {
  if (earningsCalCache && (Date.now() - earningsCalCache.fetchedAt) < EARNINGS_CAL_CACHE_MS
      && earningsCalCache.from === from && earningsCalCache.to === to) {
    return earningsCalCache.data;
  }
  try {
    const payload = await getResearchEarningsCalendarRequest({ from, to });
    const entries = Array.isArray(payload?.entries) ? payload.entries : [];
    if (Array.isArray(entries)) {
      const mapped = entries.map(entry => ({
        ...entry,
        internalTicker: FMP_REVERSE[entry.symbol] || entry.symbol,
      }));
      earningsCalCache = { data: mapped, fetchedAt: Date.now(), from, to };
      return mapped;
    }
    return null;
  } catch(e) {
    return null;
  }
}

// SEC filings cache: per-ticker list of recent filings. TTL 6 hours.
const secFilingsCache = new Map();
const SEC_FILINGS_CACHE_MS = 6 * 60 * 60 * 1000;

async function fetchSECFilings(ticker) {
  if (!ticker) return null;
  const cached = secFilingsCache.get(ticker);
  if (cached && (Date.now() - cached.fetchedAt) < SEC_FILINGS_CACHE_MS) return cached.data;
  try {
    const payload = await getResearchSecFilingsRequest({ symbol: ticker, limit: 25 });
    const filings = Array.isArray(payload?.filings) ? payload.filings : null;
    if (Array.isArray(filings)) {
      secFilingsCache.set(ticker, { data: filings, fetchedAt: Date.now() });
      return filings;
    }
    return null;
  } catch(e) {
    return null;
  }
}

// Earnings call transcripts cache: per-ticker latest transcript. TTL 12 hours.
// FMP endpoint returns full transcript text with speaker-turn segmentation.
const transcriptsCache = new Map();
const TRANSCRIPTS_CACHE_MS = 12 * 60 * 60 * 1000;

async function fetchTranscript(ticker, key, quarter, year) {
  if (!ticker) return null;
  const cacheKey = ticker + (quarter ? `-Q${quarter}` : "") + (year ? `-${year}` : "");
  const cached = transcriptsCache.get(cacheKey);
  if (cached && (Date.now() - cached.fetchedAt) < TRANSCRIPTS_CACHE_MS) return cached.data;
  try {
    const payload = await getResearchTranscriptRequest({
      symbol: ticker,
      quarter,
      year,
    });
    const entry = payload?.transcript || null;
    if (entry) transcriptsCache.set(cacheKey, { data: entry, fetchedAt: Date.now() });
    return entry;
  } catch(e) {
    return null;
  }
}

// List of available transcript quarters for a ticker (lightweight metadata endpoint).
async function fetchTranscriptList(ticker) {
  if (!ticker) return null;
  try {
    const payload = await getResearchTranscriptsRequest({ symbol: ticker });
    return Array.isArray(payload?.transcripts) ? payload.transcripts : null;
  } catch(e) {
    return null;
  }
}

// Pick the broker timeframe/granularity for a given period.
// Intraday gives us 15-min and 1-hour bars for recent short windows; daily otherwise.
// Returns { interval: "15min"|"1hour"|"daily", barsEstimate: number } for the period.
function pickIntervalForPeriod(period) {
  switch (period) {
    case "1W":   return { interval: "15min", barsEstimate: 130 };   // ~5 days × 26 half-hours
    case "1M":   return { interval: "1hour", barsEstimate: 160 };   // ~22 trading days × 7 hours
    case "3M":   return { interval: "daily", barsEstimate: 66 };
    case "6M":   return { interval: "daily", barsEstimate: 130 };
    case "YTD":  return { interval: "daily", barsEstimate: 260 };
    case "1Y":   return { interval: "daily", barsEstimate: 260 };
    case "5Y":   return { interval: "daily", barsEstimate: 1300 };
    default:     return { interval: "daily", barsEstimate: 66 };
  }
}

function resolveHistSourceLabel(bars) {
  const sources = new Set((bars || []).map((bar) => bar?.source).filter(Boolean));
  if (sources.has("ibkr+massive-gap-fill")) return "IBKR + GAP";
  if (sources.has("ibkr-history")) return "IBKR";
  if (sources.has("ibkr-websocket-derived")) return "IBKR WS";
  return sources.size ? "BROKER" : "";
}

async function fetchHist(ticker, periodOrDays) {
  // Accept either a period string ("1W", "1M", ...) or legacy numeric days
  const { interval, barsEstimate } = typeof periodOrDays === "string"
    ? pickIntervalForPeriod(periodOrDays)
    : { interval: "daily", barsEstimate: periodOrDays };

  // Cache keyed by ticker+interval (intraday and daily don't share)
  const cacheKey = ticker + "|" + interval;
  const cached = histCache.get(cacheKey);
  if (cached && (Date.now() - cached.fetchedAt) < HIST_CACHE_MS && cached.hist.length >= Math.min(barsEstimate, cached.hist.length)) {
    return {
      status: "live",
      hist: cached.hist.slice(-barsEstimate),
      interval,
      sourceLabel: cached.sourceLabel || "IBKR",
    };
  }
  try {
    const timeframe = interval === "15min" ? "15m" : interval === "1hour" ? "1h" : "1d";
    const payload = await getBarsRequest({
      symbol: ticker,
      timeframe,
      limit: barsEstimate,
      outsideRth: timeframe !== "1d",
      source: "trades",
    });
    const bars = Array.isArray(payload?.bars) ? payload.bars : [];
    const sourceLabel = resolveHistSourceLabel(bars) || "IBKR";
    let hist;
    if (interval === "daily") {
      if (bars.length > 0) {
        hist = bars.map(h => {
          const iso = new Date(h.timestamp).toISOString();
          return {
            date: iso.slice(5, 10),
            fullDate: iso.slice(0, 10),
            isoDT: iso,
            price: h.close,
          };
        });
      } else {
        return { status: "nodata", hist: null };
      }
    } else {
      if (bars.length > 0) {
        hist = bars.map(h => {
          const iso = new Date(h.timestamp).toISOString();
          return {
            date: iso.slice(11, 16),
            fullDate: iso.slice(0, 10),
            isoDT: iso,
            price: h.close,
          };
        });
      } else {
        return { status: "nodata", hist: null };
      }
    }
    histCache.set(cacheKey, { hist, fetchedAt: Date.now(), interval, sourceLabel });
    return { status: "live", hist: hist.slice(-barsEstimate), interval, sourceLabel };
  } catch(e) {
    return { status: "error", hist: null };
  }
}

/* ════════════════════════ FORMATTING ════════════════════════ */
const fmtMC = n => {
  if (n == null) return "\u2014";
  if (Math.abs(n) >= 1e6) return "$" + (n / 1e6).toFixed(1) + "T";
  if (Math.abs(n) >= 1e3) return "$" + (n / 1e3).toFixed(0) + "B";
  return "$" + n + "M";
};

const fmtFS = n => {
  if (n == null || isNaN(n)) return "\u2014";
  const abs = Math.abs(Math.round(n));
  const str = abs.toLocaleString("en-US");
  return n < 0 ? "(" + str + ")" : str;
};

const fmtPct = n => (n > 0 ? "+" : "") + n.toFixed(1) + "%";

/* ════════════════════════ FINANCIAL DATA GENERATOR ════════════════════════ */
function genFinancials(co, scenarioAdj = null) {
  const years = ["2022", "2023", "2024", "2025", "2026E"];
  const baseRev = co.r;
  const gm = co.g / 100;
  const rgs = co.fin.rg;

  // Build revenue series working backwards from current
  const revs = [0, 0, 0, 0, baseRev];
  if (scenarioAdj && scenarioAdj.revPct) {
    revs[4] = baseRev * (1 + scenarioAdj.revPct / 100);
  }
  for (let i = 3; i >= 0; i--) {
    revs[i] = Math.round(revs[i + 1] / (1 + (rgs[i + 1] || 5) / 100));
  }

  // Sector-appropriate ratios
  const isCompute = co.v === "compute";
  const isHyper = co.v === "hyperscaler";
  const rdPct = isCompute ? 0.22 : isHyper ? 0.15 : co.v === "photonics" ? 0.18 : 0.12;
  const sgaPct = isHyper ? 0.08 : 0.13;

  // Adjusted GM for scenario
  const adjGM = scenarioAdj && scenarioAdj.gmAdj ? gm + scenarioAdj.gmAdj / 10000 : gm;

  // Income Statement per year
  const makeIS = (rev, useAdj) => {
    const thisGM = useAdj ? adjGM : gm;
    const cogs = Math.round(rev * (1 - thisGM));
    const grossProfit = rev - cogs;
    const rd = Math.round(rev * rdPct);
    const sga = Math.round(rev * sgaPct);
    const da = Math.round(rev * 0.05);
    const opIncome = grossProfit - rd - sga - da;
    const intExp = Math.round(Math.max(0, rev * (co.dc.f < 0 ? 0.025 : 0.008)));
    const otherInc = Math.round(rev * 0.003);
    const preTax = opIncome - intExp + otherInc;
    const tax = Math.round(preTax > 0 ? preTax * 0.19 : 0);
    const netIncome = preTax - tax;
    return { rev, cogs, grossProfit, rd, sga, da, totalOpex: rd + sga + da, opIncome, intExp, otherInc, preTax, tax, netIncome, eps: +(netIncome / (co.dc.sh || 1)).toFixed(2) };
  };

  // Balance Sheet per year
  const makeBS = (rev) => {
    const cash = Math.round(rev * 0.18);
    const sti = Math.round(rev * 0.12);
    const recv = Math.round(rev * 0.16);
    const invFG = Math.round(rev * 0.04);
    const invWIP = Math.round(rev * 0.035);
    const invRM = Math.round(rev * 0.025);
    const inv = invFG + invWIP + invRM;
    const prepaid = Math.round(rev * 0.03);
    const cashSTI = cash + sti;
    const ca = cashSTI + recv + inv + prepaid;
    const ppe = Math.round(rev * 0.30);
    const gw = Math.round(rev * 0.18);
    const otherLT = Math.round(rev * 0.08);
    const ta = ca + ppe + gw + otherLT;
    const ap = Math.round(rev * 0.06);
    const stDebt = Math.round(rev * 0.04);
    const accrued = Math.round(rev * 0.05);
    const cl = ap + stDebt + accrued;
    const ltDebt = Math.round(co.mc * 0.04);
    const otherLTL = Math.round(rev * 0.06);
    const tl = cl + ltDebt + otherLTL;
    const equity = ta - tl;
    return { cash, sti, cashSTI, recv, invFG, invWIP, invRM, inv, prepaid, ca, ppe, gw, otherLT, ta, ap, stDebt, accrued, cl, ltDebt, otherLTL, tl, equity, tlse: ta };
  };

  const isData = revs.map((rev, i) => makeIS(rev, i === 4));
  const bsData = revs.map(rev => makeBS(rev));

  // Cash Flow Statement per year (uses BS deltas)
  const makeCF = (i) => {
    const is = isData[i], bs = bsData[i];
    const prevBS = i > 0 ? bsData[i - 1] : null;
    const sbc = Math.round(is.rev * (isCompute || isHyper ? 0.04 : 0.025));
    const dAR = prevBS ? bs.recv - prevBS.recv : 0;
    const dInv = prevBS ? bs.inv - prevBS.inv : 0;
    const dAP = prevBS ? bs.ap - prevBS.ap : 0;
    const dAccr = prevBS ? bs.accrued - prevBS.accrued : 0;
    const wcImpact = -dAR - dInv + dAP + dAccr;
    const cfo = is.netIncome + is.da + sbc + wcImpact;
    const capex = prevBS ? (bs.ppe - prevBS.ppe) + is.da : Math.round(is.rev * 0.08);
    const cfi = -capex;
    const divPaid = co.fin.div ? -Math.round(co.fin.div * (co.dc.sh || 0)) : 0;
    const buybacks = is.netIncome > 0 ? -Math.round(is.rev * 0.035) : 0;
    const debtChg = prevBS ? bs.ltDebt - prevBS.ltDebt : 0;
    const cff = divPaid + buybacks + debtChg;
    const fcf = cfo - capex;
    const netCashChg = cfo + cfi + cff;
    return { netIncome: is.netIncome, da: is.da, sbc, dAR: -dAR, dInv: -dInv, dAP, dAccr, wcImpact, cfo, capex: -capex, cfi, divPaid, buybacks, debtChg, cff, fcf, netCashChg };
  };
  const cfData = revs.map((_, i) => makeCF(i));

  // Key Ratios per year
  const ratiosData = revs.map((rev, i) => {
    const is = isData[i], bs = bsData[i], cf = cfData[i];
    const nopat = is.opIncome * 0.79;
    const investedCap = bs.equity + bs.ltDebt;
    const ebitda = is.opIncome + is.da;
    return {
      roic: investedCap > 0 && nopat > 0 ? +(nopat / investedCap * 100).toFixed(1) : null,
      fcfMargin: rev > 0 ? +(cf.fcf / rev * 100).toFixed(1) : null,
      fcfYield: i === 4 && co.mc > 0 ? +(cf.fcf / co.mc * 100).toFixed(1) : null,
      debtEbitda: ebitda > 0 ? +(bs.ltDebt / ebitda).toFixed(1) : null,
      netDebt: bs.ltDebt - bs.cashSTI,
      currentRatio: bs.cl > 0 ? +(bs.ca / bs.cl).toFixed(2) : null,
      rdIntensity: rev > 0 ? +(is.rd / rev * 100).toFixed(1) : null,
      capexIntensity: rev > 0 ? +(Math.abs(cf.capex) / rev * 100).toFixed(1) : null,
      gmPct: rev > 0 ? +(is.grossProfit / rev * 100).toFixed(1) : null,
      opmPct: rev > 0 ? +(is.opIncome / rev * 100).toFixed(1) : null,
      netMargin: rev > 0 ? +(is.netIncome / rev * 100).toFixed(1) : null,
      runwayQtrs: is.netIncome < 0 && bs.cashSTI > 0 ? +(bs.cashSTI / (Math.abs(is.netIncome) / 4)).toFixed(1) : null,
    };
  });

  // Quarterly EPS (12 quarters) — seeded per ticker
  let epsSeed = 0;
  for (let i = 0; i < co.t.length; i++) epsSeed = ((epsSeed << 5) - epsSeed + co.t.charCodeAt(i)) | 0;
  const epsRand = () => { epsSeed = (epsSeed * 16807 + 0) % 2147483647; return (epsSeed & 0x7fffffff) / 2147483647; };
  const qEPS = [];
  for (let i = 0; i < 12; i++) {
    const yr = 2023 + Math.floor(i / 4);
    const qtr = (i % 4) + 1;
    const annualEPS = isData[Math.min(4, yr - 2022)]?.eps || 0;
    const qBase = annualEPS / 4;
    const estimate = +(qBase * (0.94 + epsRand() * 0.08)).toFixed(2);
    const actual = +(qBase * (0.92 + epsRand() * 0.18)).toFixed(2);
    const beat = actual >= estimate;
    qEPS.push({ label: "Q" + qtr + " '" + String(yr).slice(2), actual, estimate, beat, diff: +(actual - estimate).toFixed(2) });
  }

  // Annual earnings + estimates
  const annualEarnings = years.map((y, i) => ({
    year: y,
    earnings: isData[i].netIncome,
    isEstimate: i >= 4,
  }));

  return { years, revs, isData, bsData, cfData, ratiosData, qEPS, annualEarnings };
}

/* ════════════════════════ SPARKLINE COMPONENT ════════════════════════ */
function Sparkline({ values, width = 52, height = 16 }) {
  if (!values || values.length < 2) return null;
  const mn = Math.min(...values);
  const mx = Math.max(...values);
  const rng = mx - mn || 1;
  const pts = values.map((v, i) =>
    `${(i / (values.length - 1)) * width},${height - 2 - ((v - mn) / rng) * (height - 4)}`
  ).join(" ");
  const trend = values[values.length - 1] > values[0];
  const color = trend ? "#1a8a5c" : "#c44040";
  return (
    <svg width={width} height={height} style={{ display: "inline-block", verticalAlign: "middle" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ════════════════════════ RANGE BAR (for day/52wk ranges) ════════════════════════ */
function RangeBar({ low, high, current, color }) {
  const pct = ((current - low) / (high - low || 1)) * 100;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10 }}>
      <span style={{ color: "#888", minWidth: 50, textAlign: "right" }}>${low.toFixed(2)}</span>
      <div style={{ flex: 1, height: 4, background: "rgba(0,0,0,.06)", borderRadius: 2, position: "relative" }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: 4, width: pct + "%", background: color, borderRadius: 2, opacity: 0.5 }} />
        <div style={{ position: "absolute", left: `calc(${pct}% - 4px)`, top: -2, width: 8, height: 8, borderRadius: "50%", background: color, border: "1.5px solid #ffffff" }} />
      </div>
      <span style={{ color: "#888", minWidth: 50 }}>${high.toFixed(2)}</span>
    </div>
  );
}

/* ════════════════════════ SNAPSHOT TAB ════════════════════════ */

/* ════════════════════════ FINANCIALS TAB ════════════════════════ */
const IS_TEMPLATE = [
  { k: "rev", l: "Revenue", d: 0, bold: true },
  { k: "cogs", l: "Cost of revenue", d: 0 },
  { k: "grossProfit", l: "Gross profit", d: 0, bold: true, expandable: true },
  { k: "rd", l: "Research & development", d: 1, parent: "grossProfit" },
  { k: "sga", l: "Selling, general & admin", d: 1, parent: "grossProfit" },
  { k: "da", l: "Depreciation & amortization", d: 1, parent: "grossProfit" },
  { k: "totalOpex", l: "Total operating expenses", d: 1, parent: "grossProfit", bold: true },
  { k: "opIncome", l: "Operating income", d: 0, bold: true, expandable: true },
  { k: "intExp", l: "Interest expense", d: 1, parent: "opIncome" },
  { k: "otherInc", l: "Other income", d: 1, parent: "opIncome" },
  { k: "preTax", l: "Pre-tax income", d: 0, bold: true },
  { k: "tax", l: "Income tax provision", d: 0 },
  { k: "netIncome", l: "Net income", d: 0, bold: true },
  { k: "eps", l: "EPS (basic)", d: 0 },
];

const BS_TEMPLATE = [
  { k: "ca", l: "Total current assets", d: 0, bold: true, expandable: true },
  { k: "cashSTI", l: "Cash and short term inv", d: 1, parent: "ca", expandable: true },
  { k: "cash", l: "Cash & equivalents", d: 2, parent: "cashSTI" },
  { k: "sti", l: "Short term investments", d: 2, parent: "cashSTI" },
  { k: "recv", l: "Total receivables, net", d: 1, parent: "ca" },
  { k: "inv", l: "Total inventory", d: 1, parent: "ca", expandable: true },
  { k: "invFG", l: "Invent. - finished goods", d: 2, parent: "inv" },
  { k: "invWIP", l: "Invent. - work in progress", d: 2, parent: "inv" },
  { k: "invRM", l: "Invent. - raw materials", d: 2, parent: "inv" },
  { k: "prepaid", l: "Prepaid expenses", d: 1, parent: "ca" },
  { k: "ta", l: "Total assets", d: 0, bold: true, expandable: true },
  { k: "ppe", l: "Property/plant/equip, net", d: 1, parent: "ta" },
  { k: "gw", l: "Goodwill & intangibles", d: 1, parent: "ta" },
  { k: "otherLT", l: "Other long-term assets", d: 1, parent: "ta" },
  { k: "cl", l: "Total current liabilities", d: 0, bold: true, expandable: true },
  { k: "ap", l: "Accounts payable", d: 1, parent: "cl" },
  { k: "stDebt", l: "Short term debt", d: 1, parent: "cl" },
  { k: "accrued", l: "Accrued expenses", d: 1, parent: "cl" },
  { k: "ltDebt", l: "Long-term debt", d: 0 },
  { k: "tl", l: "Total liabilities", d: 0, bold: true },
  { k: "equity", l: "Total equity", d: 0, bold: true },
  { k: "tlse", l: "Total liabilities & equity", d: 0, bold: true },
];

function FinancialsTab({ co, color, scenarioAdj }) {
  const [subTab, setSubTab] = useState("is");
  const [expanded, setExpanded] = useState(new Set(["grossProfit", "ca", "ta"]));

  const fd = useMemo(() => genFinancials(co, scenarioAdj), [co.t, scenarioAdj]);
  const baseFD = useMemo(() => genFinancials(co, null), [co.t]);
  const hasAdj = scenarioAdj && (scenarioAdj.revPct || scenarioAdj.gmAdj);

  const toggle = (k) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  };

  const template = subTab === "is" ? IS_TEMPLATE : BS_TEMPLATE;
  const dataArr = subTab === "is" ? fd.isData : fd.bsData;
  const baseDataArr = subTab === "is" ? baseFD.isData : baseFD.bsData;

  // Check visibility: row is visible if all ancestor parents are expanded
  const isVisible = (row) => {
    if (!row.parent) return true;
    // Walk up parent chain
    let current = row;
    while (current.parent) {
      if (!expanded.has(current.parent)) return false;
      current = template.find(r => r.k === current.parent) || {};
    }
    return true;
  };

  const visibleRows = template.filter(isVisible);

  return (
    <div>
      {/* Scenario banner */}
      {hasAdj && (
        <div style={{
          background: "rgba(205,162,78,.08)", border: "1px solid rgba(205,162,78,.2)",
          borderRadius: 6, padding: "6px 10px", marginBottom: 10, fontSize: 12, color: "#b8860b", display: "flex", alignItems: "center", gap: 6,
        }}>
          <span style={{ fontSize: 12 }}>!</span>
          Scenario adjustment applied: {scenarioAdj.revPct ? "Rev " + (scenarioAdj.revPct > 0 ? "+" : "") + scenarioAdj.revPct + "%" : ""} {scenarioAdj.gmAdj ? "GM " + (scenarioAdj.gmAdj > 0 ? "+" : "") + scenarioAdj.gmAdj + "bps" : ""}
          <span style={{ fontSize: 12, marginLeft: "auto", color: "#777" }}>2026E column adjusted</span>
        </div>
      )}

      {/* Sub-tabs + Period toggle */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, borderBottom: "1px solid rgba(0,0,0,.035)" }}>
        <div style={{ display: "flex", gap: 0 }}>
          {[["is", "Income Statement"], ["bs", "Balance Sheet"], ["cf", "Cash Flow"]].map(([id, lb]) => (
            <button key={id} onClick={() => setSubTab(id)} style={{
              background: "none", border: "none",
              borderBottom: subTab === id ? "2px solid " + color : "2px solid transparent",
              padding: "5px 12px", color: subTab === id ? color : "#555",
              fontSize: 10, fontWeight: 600, cursor: "pointer",
            }}>{lb}</button>
          ))}
        </div>

      </div>

      {subTab === "cf" ? (
        <CashFlowTable fd={fd} color={color} />
      ) : (
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "5px 6px", fontSize: 11, color: "#aaa", letterSpacing: 1, minWidth: 160 }}>
                Item
              </th>
              {fd.years.map(y => (
                <th key={y} style={{ textAlign: "right", padding: "5px 8px", fontSize: 11, color: y.includes("E") ? color : "#555" }}>
                  {y}
                </th>
              ))}
              <th style={{ textAlign: "center", padding: "5px 4px", fontSize: 10, color: "#aaa", minWidth: 56 }}>
                5-yr trend
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, idx) => {
              const values = dataArr.map(d => d[row.k]);
              const baseValues = baseDataArr.map(d => d[row.k]);
              const isEPS = row.k === "eps";
              const isAdjusted = hasAdj && values[4] !== baseValues[4];

              return (
                <tr
                  key={row.k}
                  onClick={row.expandable ? () => toggle(row.k) : undefined}
                  style={{
                    cursor: row.expandable ? "pointer" : "default",
                    background: idx % 2 === 0 ? "rgba(0,0,0,.012)" : "transparent",
                    borderBottom: "1px solid rgba(0,0,0,.03)",
                  }}
                >
                  <td style={{
                    padding: "5px 6px 5px " + (10 + row.d * 18) + "px",
                    fontSize: 11,
                    color: row.bold ? "#222" : "#555",
                    fontWeight: row.bold ? 600 : 400,
                    whiteSpace: "nowrap",
                  }}>
                    {row.expandable && (
                      <span style={{ display: "inline-block", width: 14, fontSize: 11, color: "#999", transition: "transform 0.15s" }}>
                        {expanded.has(row.k) ? "\u25BC" : "\u25B6"}
                      </span>
                    )}
                    {!row.expandable && row.d > 0 && <span style={{ display: "inline-block", width: 14 }} />}
                    {row.l}
                  </td>
                  {values.map((v, i) => (
                    <td key={i} style={{
                      padding: "5px 8px", textAlign: "right", fontSize: 10,
                      color: v < 0 ? "#c44040" : (isAdjusted && i === 4 ? "#b8860b" : "#444"),
                      fontWeight: row.bold ? 600 : 400,
                    }}>
                      {isEPS ? (v < 0 ? "(" + Math.abs(v).toFixed(2) + ")" : v.toFixed(2)) : fmtFS(v)}
                    </td>
                  ))}
                  <td style={{ padding: "5px 4px", textAlign: "center" }}>
                    <Sparkline values={values} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

/* ════════════════════════ VALUATION TAB ════════════════════════ */
function ValuationTab({ co, color, scenarioAdj, onScenarioChange }) {
  const [ov, setOv] = useState({});
  const [scen, setScen] = useState("");
  const [aiR, setAiR] = useState(null);
  const [loading, setLoading] = useState(false);

  const dcfInputs = { ...co.dc, ...ov };
  const dcfVal = useMemo(() => {
    const { f, gr, w, tg, sh } = dcfInputs;
    if (!f || !sh) return 0;
    let p = f, tot = 0;
    for (let y = 1; y <= 10; y++) {
      p *= 1 + (gr * Math.pow(0.9, y - 1)) / 100;
      tot += p / Math.pow(1 + w / 100, y);
    }
    const tv = (p * (1 + tg / 100)) / ((w - tg) / 100);
    return (tot + tv / Math.pow(1 + w / 100, 10)) / sh;
  }, [dcfInputs]);

  const price = co.mc / (co.dc.sh || 1);
  const upside = dcfVal > 0 ? ((dcfVal - price) / price * 100) : null;

  // Slider with local state for smooth dragging - commits on release
  const [dragState, setDragState] = useState({});
  const SliderRow = ({ label, field, min, max, step, unit = "" }) => {
    const committed = dcfInputs[field];
    const display = dragState[field] ?? committed;
    return (
      <div style={{ marginBottom: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 1 }}>
          <span style={{ fontSize: 10, color: "#888" }}>{label}</span>
          <span style={{ fontSize: 10, color, fontWeight: 600 }}>{display?.toFixed(1)}{unit}</span>
        </div>
        <input type="range" min={min} max={max} step={step} value={display || 0}
          onChange={e => setDragState(prev => ({ ...prev, [field]: parseFloat(e.target.value) }))}
          onPointerUp={e => { setOv(prev => ({ ...prev, [field]: parseFloat(e.target.value) })); setDragState(prev => { const n = {...prev}; delete n[field]; return n; }); }}
          onTouchEnd={e => { const v = dragState[field]; if (v != null) { setOv(prev => ({ ...prev, [field]: v })); setDragState(prev => { const n = {...prev}; delete n[field]; return n; }); } }}
          style={{ width: "100%", accentColor: color, height: 2 }}
        />
      </div>
    );
  };

  const runScenario = async () => {
    if (!scen.trim()) return;
    setLoading(true);
    setAiR({
      impact: "neutral",
      reasoning: "Browser-side model calls were removed. Wire a server-side AI provider into the API layer to restore scenario analysis.",
      valPct: "\u2014",
      confidence: "low",
    });
    setLoading(false);
  };

  return (
    <div>
      {/* DCF Model */}
      <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 10, padding: 10, marginBottom: 10, boxShadow: "0 1px 3px rgba(0,0,0,.03)" }}>
        <div style={{ fontSize: 11, fontWeight: 600, color, marginBottom: 6, letterSpacing: 1 }}>
          DISCOUNTED CASH FLOW MODEL
        </div>
        <SliderRow label="Base Free Cash Flow ($M)" field="f" min={Math.min(-500, co.dc.f * 3)} max={Math.max(500, co.dc.f * 3)} step={Math.max(1, Math.abs(co.dc.f / 50))} unit="M" />
        <SliderRow label="FCF Growth Rate" field="gr" min={-10} max={Math.max(50, co.dc.gr * 2)} step={1} unit="%" />
        <SliderRow label="Weighted Avg Cost of Capital" field="w" min={5} max={25} step={0.5} unit="%" />
        <SliderRow label="Terminal Growth Rate" field="tg" min={0} max={5} step={0.25} unit="%" />

        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          {[
            ["DCF Intrinsic", dcfVal > 0 ? "$" + dcfVal.toFixed(2) : "NEGATIVE", dcfVal > 0 ? "#1a8a5c" : "#c44040"],
            ["Current Price", "$" + price.toFixed(2), "#333"],
            ["Implied Upside", upside != null ? (upside > 0 ? "+" : "") + upside.toFixed(0) + "%" : "\u2014", upside > 0 ? "#1a8a5c" : "#c44040"],
          ].map(([label, value, clr]) => (
            <div key={label} style={{ flex: 1, background: "rgba(0,0,0,.01)", borderRadius: 6, padding: "4px 4px", textAlign: "center", border: "1px solid rgba(0,0,0,.04)" }}>
              <div style={{ fontSize: 10, color: "#999", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: clr, marginTop: 1 }}>{value}</div>
            </div>
          ))}
        </div>
        <button onClick={() => setOv({})} style={{
          marginTop: 5, width: "100%", background: "#fff", border: "1px solid rgba(0,0,0,.08)",
          borderRadius: 4, padding: 3, color: "#999", fontSize: 11, cursor: "pointer",
        }}>RESET TO BASE CASE</button>
      </div>

      {/* What-If Scenario Engine */}
      <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 10, padding: 14, boxShadow: "0 1px 3px rgba(0,0,0,.03)" }}>
        <div style={{ fontSize: 10, fontWeight: 600, color, marginBottom: 8, letterSpacing: 1 }}>
          WHAT-IF SCENARIO ENGINE
        </div>
        <div style={{ fontSize: 10, color: "#888", marginBottom: 5, lineHeight: 1.4 }}>
          This panel is reserved for a server-side scenario engine. The direct browser LLM call was removed so model credentials stay out of the client.
        </div>
        <textarea value={scen} onChange={e => setScen(e.target.value)}
          placeholder={"e.g. 'US imposes 50% tariff on all semiconductor imports from China'\nor '" + co.nm + "'s largest customer switches to a competitor'"}
          style={{
            width: "100%", background: "rgba(0,0,0,.035)", border: "1px solid rgba(0,0,0,.10)",
            borderRadius: 5, padding: 7, color: "#444", fontSize: 11,
            resize: "vertical", minHeight: 42, boxSizing: "border-box", lineHeight: 1.5,
          }}
        />
        <button onClick={runScenario} disabled={loading || !scen.trim()} style={{
          marginTop: 6, width: "100%", background: loading ? "#1a1a1a" : color, border: "none",
          borderRadius: 5, padding: "5px 0", color: loading ? "#555" : "#fff",
          fontSize: 11, fontWeight: 700, cursor: loading ? "wait" : "pointer", letterSpacing: 0.5,
        }}>
          {loading ? "CHECKING..." : "SCENARIO AI STATUS"}
        </button>

        {aiR && (
          <div style={{
            marginTop: 6, background: "rgba(0,0,0,.035)", borderRadius: 5, padding: 8,
            borderLeft: "3px solid " + (aiR.impact === "positive" ? "#1a8a5c" : aiR.impact === "negative" ? "#c44040" : "#CDA24E"),
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 5 }}>
              <span style={{
                fontSize: 11, padding: "2px 6px", borderRadius: 4, fontWeight: 700, textTransform: "uppercase",
                background: aiR.impact === "positive" ? "rgba(72,200,156,.15)" : aiR.impact === "negative" ? "rgba(216,104,104,.15)" : "rgba(205,162,78,.15)",
                color: aiR.impact === "positive" ? "#1a8a5c" : aiR.impact === "negative" ? "#c44040" : "#CDA24E",
              }}>
                {aiR.impact || "unknown"}
              </span>
              <span style={{ fontSize: 11, color: "#888" }}>
                Confidence: {aiR.confidence}
              </span>
            </div>

            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              {[
                ["Revenue Impact", aiR.revPct ? (aiR.revPct > 0 ? "+" : "") + aiR.revPct + "%" : aiR.revEffect || "\u2014"],
                ["Margin Impact", aiR.gmBps ? (aiR.gmBps > 0 ? "+" : "") + aiR.gmBps + " bps" : "\u2014"],
                ["Valuation", aiR.valPct || "\u2014"],
              ].map(([l, v]) => (
                <div key={l} style={{ flex: 1, background: "rgba(0,0,0,.01)", borderRadius: 4, padding: "3px 5px", border: "1px solid rgba(0,0,0,.04)" }}>
                  <div style={{ fontSize: 10, color: "#999", textTransform: "uppercase", letterSpacing: 1 }}>{l}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#333", marginTop: 2 }}>{v}</div>
                </div>
              ))}
            </div>

            <div style={{ fontSize: 10.5, color: "#666", lineHeight: 1.6 }}>
              {aiR.reasoning}
            </div>

            {(aiR.revPct || aiR.gmBps) && (
              <div style={{ marginTop: 8, fontSize: 11, color: "#b8860b" }}>
                \u2192 Adjustments applied to Financials tab (2026E column)
              </div>
            )}
          </div>
        )}

        {scenarioAdj && (scenarioAdj.revPct || scenarioAdj.gmAdj) && (
          <button onClick={() => onScenarioChange(null)} style={{
            marginTop: 8, width: "100%", background: "rgba(205,162,78,.08)",
            border: "1px solid rgba(205,162,78,.2)", borderRadius: 4, padding: 5,
            color: "#b8860b", fontSize: 11, cursor: "pointer",
          }}>CLEAR SCENARIO ADJUSTMENTS</button>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════ DETAIL HELPERS & UTILITIES ════════════════════════ */

// Color shading for stacked bars
function shade(hex, i) {
  if (!hex) return "#888";
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  const f = Math.max(0.45, 1 - i * 0.16);
  return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
}

// Find peer companies: same sub-layer first, then same vertical, sorted by MC proximity
function getPeers(co, n = 4) {
  const same = COMPANIES.filter(c => c.v === co.v && c.s === co.s && c.t !== co.t);
  const vertical = COMPANIES.filter(c => c.v === co.v && c.s !== co.s && c.t !== co.t);
  same.sort((a, b) => Math.abs(Math.log((a.mc || 1) / (co.mc || 1))) - Math.abs(Math.log((b.mc || 1) / (co.mc || 1))));
  vertical.sort((a, b) => Math.abs(Math.log((a.mc || 1) / (co.mc || 1))) - Math.abs(Math.log((b.mc || 1) / (co.mc || 1))));
  return [...same, ...vertical].slice(0, n);
}

// Minimal SVG sparkline — shows price trend from an array of {price} points.
// Auto-colors green/red based on net change. No axes, no labels — pure shape.
function PriceSparkline({ data, width = 80, height = 22, strokeWidth = 1 }) {
  if (!data || data.length < 2) {
    return <span style={{ color: "#ccc", fontSize: 10 }}>—</span>;
  }
  // Downsample to ~50 points max for performance/readability
  const stride = Math.max(1, Math.ceil(data.length / 50));
  const sampled = [];
  for (let i = 0; i < data.length; i += stride) sampled.push(data[i]);
  // Always include last point for accurate endpoint
  if (sampled[sampled.length - 1] !== data[data.length - 1]) sampled.push(data[data.length - 1]);

  const prices = sampled.map(d => d.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || max * 0.01 || 1;
  const pad = 1;
  const points = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * (width - pad * 2) + pad;
    const y = height - pad - ((p - min) / range) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  const start = prices[0];
  const end = prices[prices.length - 1];
  const ret = start > 0 ? (end - start) / start * 100 : 0;
  const color = ret >= 0 ? "#1a8a5c" : "#c44040";
  const fillColor = ret >= 0 ? "rgba(26,138,92,.1)" : "rgba(196,64,64,.1)";

  // Fill path: same shape but closed to baseline
  const fillPoints = points + ` ${(width - pad).toFixed(1)},${(height - pad).toFixed(1)} ${pad.toFixed(1)},${(height - pad).toFixed(1)}`;

  return (
    <svg width={width} height={height} style={{ display: "block", overflow: "visible" }} aria-label={`sparkline ${ret >= 0 ? "+" : ""}${ret.toFixed(1)}%`}>
      <polygon points={fillPoints} fill={fillColor} stroke="none" />
      <polyline points={points} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={(width - pad).toFixed(1)} cy={(height - pad - ((end - min) / range) * (height - pad * 2)).toFixed(1)} r="1.5" fill={color} />
    </svg>
  );
}

// Horizontal stacked bar with legend (used for segments, geo, customers)
function StackedBar({ data, color, height = 18 }) {
  if (!data || data.length === 0) return null;
  const total = data.reduce((a, x) => a + (x[1] || 0), 0);
  if (total === 0) return null;
  return (
    <div>
      <div style={{ display: "flex", height, borderRadius: 4, overflow: "hidden", border: "1px solid rgba(0,0,0,.05)" }}>
        {data.map(([label, val], i) => {
          const pct = val / total * 100;
          return (
            <div key={label + i} title={`${label}: ${pct.toFixed(1)}%`} style={{
              width: pct + "%", background: shade(color, i),
              display: "flex", alignItems: "center", justifyContent: "center",
              borderRight: i < data.length - 1 ? "1px solid rgba(255,255,255,.4)" : "none",
            }}>
              {pct > 10 && <span style={{ fontSize: 9, color: "#fff", fontWeight: 700, letterSpacing: 0.3 }}>{Math.round(pct)}%</span>}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 5, flexWrap: "wrap" }}>
        {data.map(([label, val], i) => (
          <span key={label + i} style={{ fontSize: 10, color: "#666", display: "inline-flex", alignItems: "center", gap: 3 }}>
            <span style={{ width: 8, height: 8, background: shade(color, i), borderRadius: 1, display: "inline-block" }} />
            {label} <span style={{ color: "#999" }}>{(val / total * 100).toFixed(0)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// Mini sparkline for trend data (percentages over time)
function TrendSpark({ values, color, width = 80, height = 22, suffix = "%" }) {
  if (!values || values.length < 2 || values.every(v => v == null)) return <span style={{ color: "#ccc", fontSize: 10 }}>—</span>;
  const clean = values.map(v => v == null ? 0 : v);
  const mn = Math.min(...clean, 0), mx = Math.max(...clean, 1);
  const rng = mx - mn || 1;
  const pts = clean.map((v, i) => [(i / (clean.length - 1)) * width, height - 4 - ((v - mn) / rng) * (height - 8)]);
  const path = "M" + pts.map(p => p[0] + "," + p[1]).join(" L");
  const area = path + ` L${pts[pts.length - 1][0]},${height} L0,${height} Z`;
  const last = clean[clean.length - 1];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <svg width={width} height={height} style={{ display: "block" }}>
        <path d={area} fill={color} fillOpacity={0.15} />
        <path d={path} fill="none" stroke={color} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.2} fill={color} />
      </svg>
      <span style={{ fontSize: 11, color: "#333", fontWeight: 700 }}>{last != null ? last.toFixed(1) + suffix : "—"}</span>
    </span>
  );
}

// Peer comparison row with distribution dot marker per metric
function PeerGrid({ co, color, onSelect }) {
  const peers = getPeers(co, 4);
  if (peers.length === 0) return null;
  const allCos = [co, ...peers];
  const metrics = [
    { k: "mc", l: "Mkt Cap", fmt: v => fmtMC(v) },
    { k: "r", l: "Revenue", fmt: v => fmtMC(v) },
    { k: "g", l: "GM", fmt: v => v + "%" },
    { k: "pe", l: "P/E", fmt: v => v ? v.toFixed(0) + "x" : "—" },
    { k: "gr", l: "Growth", fmt: v => (v > 0 ? "+" : "") + v + "%" },
  ];
  const getV = (c, k) => k === "gr" ? (c.fin?.rg?.[4] || 0) : c[k];
  return (
    <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 8, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "rgba(0,0,0,.018)", borderBottom: "1px solid rgba(0,0,0,.06)" }}>
            <th style={{ textAlign: "left", padding: "5px 8px", fontSize: 10, color: "#aaa", fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>Peer</th>
            {metrics.map(m => <th key={m.k} style={{ textAlign: "right", padding: "5px 8px", fontSize: 10, color: "#aaa", fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>{m.l}</th>)}
          </tr>
        </thead>
        <tbody>
          {allCos.map((c, ci) => {
            const isSelf = c.t === co.t;
            return (
              <tr key={c.t} onClick={() => !isSelf && onSelect && onSelect(c.t)}
                style={{ cursor: isSelf ? "default" : "pointer", borderBottom: ci < allCos.length - 1 ? "1px solid rgba(0,0,0,.04)" : "none", background: isSelf ? "rgba(205,162,78,.06)" : "transparent" }}
                onMouseEnter={e => { if (!isSelf) e.currentTarget.style.background = "rgba(0,0,0,.022)"; }}
                onMouseLeave={e => { if (!isSelf) e.currentTarget.style.background = "transparent"; }}>
                <td style={{ padding: "5px 8px", fontSize: 11 }}>
                  <Logo ticker={c.t} size={12} style={{ marginRight: 4 }} />
                  <span style={{ color: isSelf ? color : "#333", fontWeight: isSelf ? 700 : 600 }}>{c.t}</span>
                  <span style={{ color: "#aaa", marginLeft: 4, fontSize: 10 }}>{c.s}</span>
                </td>
                {metrics.map(m => {
                  const v = getV(c, m.k);
                  const vals = allCos.map(x => getV(x, m.k)).filter(x => x != null);
                  const mn = Math.min(...vals), mx = Math.max(...vals), rng = mx - mn || 1;
                  const pos = v != null ? ((v - mn) / rng) : null;
                  return (
                    <td key={m.k} style={{ padding: "5px 8px", textAlign: "right", fontSize: 11, color: "#333", fontWeight: isSelf ? 700 : 500 }}>
                      <span>{m.fmt(v)}</span>
                      {pos != null && <span style={{ display: "inline-block", width: 32, height: 3, background: "rgba(0,0,0,.06)", borderRadius: 2, marginLeft: 6, position: "relative", verticalAlign: "middle" }}>
                        <span style={{ position: "absolute", left: `calc(${pos * 100}% - 2px)`, top: -1, width: 5, height: 5, borderRadius: "50%", background: isSelf ? color : "#888" }} />
                      </span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Key Ratios strip — 4 columns, compact tile grid
function KeyRatios({ ratios, co, color }) {
  const latest = ratios[4] || {};
  const prior = ratios[3] || {};
  const trend = (k, invert) => {
    const cur = latest[k], prv = prior[k];
    if (cur == null || prv == null) return null;
    const up = cur > prv;
    return { dir: up ? "up" : "down", good: invert ? !up : up, delta: cur - prv };
  };
  const rows = [
    { k: "roic", l: "ROIC", fmt: v => v != null ? v + "%" : "—", invert: false, tip: "Return on Invested Capital" },
    { k: "fcfMargin", l: "FCF Margin", fmt: v => v != null ? v + "%" : "—", invert: false, tip: "Free Cash Flow ÷ Revenue" },
    { k: "fcfYield", l: "FCF Yield", fmt: v => v != null ? v + "%" : "—", invert: false, tip: "Free Cash Flow ÷ Market Cap" },
    { k: "debtEbitda", l: "Debt / EBITDA", fmt: v => v != null ? v + "x" : "—", invert: true, tip: "Leverage multiple" },
    { k: "currentRatio", l: "Current Ratio", fmt: v => v != null ? v + "x" : "—", invert: false, tip: "Current Assets ÷ Current Liabilities" },
    { k: "rdIntensity", l: "R&D Intensity", fmt: v => v != null ? v + "%" : "—", invert: false, tip: "R&D ÷ Revenue" },
    { k: "capexIntensity", l: "Capex Intensity", fmt: v => v != null ? v + "%" : "—", invert: true, tip: "Capex ÷ Revenue" },
    { k: "netMargin", l: "Net Margin", fmt: v => v != null ? v + "%" : "—", invert: false, tip: "Net Income ÷ Revenue" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
      {rows.map(r => {
        const t = trend(r.k, r.invert);
        const trendValues = ratios.map(x => x[r.k]);
        return (
          <div key={r.k} title={r.tip} style={{ background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 6, padding: "5px 7px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2 }}>
              <span style={{ fontSize: 9, color: "#999", textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>{r.l}</span>
              {t && <span style={{ fontSize: 9, color: t.good ? "#1a8a5c" : "#c44040", fontWeight: 700 }}>{t.dir === "up" ? "▲" : "▼"}</span>}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#222" }}>{r.fmt(latest[r.k])}</span>
              <TrendSpark values={trendValues} color={color} width={40} height={16} suffix="" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Operations strip — schema-tolerant display of company metadata
function OpsStrip({ co, color }) {
  const ops = co.ops || {};
  const own = co.own || {};
  const items = [
    ["HQ", ops.hq],
    ["Founded", ops.fd],
    ["Employees", ops.emp ? ops.emp.toLocaleString() : null],
    ["Process node", ops.node],
    ["Fab / Manufacturing", Array.isArray(ops.mfg) ? ops.mfg.join(", ") : ops.mfg],
    ["Backlog", ops.bl ? (ops.bl.label ? ops.bl.label + ": " : "") + "$" + ops.bl.val + (ops.bl.unit || "M") : null],
    ["Next earnings", ops.ne],
    ["Insider own.", own.insider != null ? own.insider + "%" : null],
    ["Institutional", own.institutional != null ? own.institutional + "%" : null],
  ].filter(x => x[1] != null);
  if (items.length === 0) return (
    <div style={{ padding: "10px 12px", background: "rgba(0,0,0,.015)", border: "1px dashed rgba(0,0,0,.08)", borderRadius: 6, textAlign: "center" }}>
      <span style={{ fontSize: 10, color: "#aaa", fontStyle: "italic" }}>Operations data pending</span>
    </div>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
      {items.map(([l, v]) => (
        <div key={l} style={{ background: "#fff", border: "1px solid rgba(0,0,0,.05)", borderRadius: 5, padding: "4px 7px" }}>
          <div style={{ fontSize: 9, color: "#aaa", textTransform: "uppercase", letterSpacing: 1, fontWeight: 600, marginBottom: 1 }}>{l}</div>
          <div style={{ fontSize: 11, color: "#333", fontWeight: 600 }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

// Schema-pending placeholder for null data sections
function DataPending({ label }) {
  return (
    <div style={{ padding: "12px 14px", background: "rgba(0,0,0,.01)", border: "1px dashed rgba(0,0,0,.08)", borderRadius: 6, textAlign: "center" }}>
      <span style={{ fontSize: 10, color: "#bbb", fontStyle: "italic" }}>{label}</span>
    </div>
  );
}

/* ════════════════════════ CASH FLOW TABLE ════════════════════════ */
const CF_TEMPLATE = [
  { k: "netIncome", l: "Net income", d: 0, bold: true },
  { k: "da", l: "+ Depreciation & amortization", d: 1 },
  { k: "sbc", l: "+ Stock-based compensation", d: 1 },
  { k: "wcImpact", l: "+ Change in working capital", d: 1 },
  { k: "cfo", l: "Cash from operations", d: 0, bold: true },
  { k: "capex", l: "Capital expenditures", d: 1 },
  { k: "cfi", l: "Cash from investing", d: 0, bold: true },
  { k: "divPaid", l: "Dividends paid", d: 1 },
  { k: "buybacks", l: "Share repurchases", d: 1 },
  { k: "debtChg", l: "Net debt issuance", d: 1 },
  { k: "cff", l: "Cash from financing", d: 0, bold: true },
  { k: "fcf", l: "Free cash flow", d: 0, bold: true },
];

function CashFlowTable({ fd, color }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "5px 6px", fontSize: 11, color: "#aaa", letterSpacing: 1, minWidth: 180 }}>Item</th>
            {fd.years.map(y => <th key={y} style={{ textAlign: "right", padding: "5px 8px", fontSize: 11, color: y.includes("E") ? color : "#555" }}>{y}</th>)}
            <th style={{ textAlign: "center", padding: "5px 4px", fontSize: 10, color: "#aaa" }}>trend</th>
          </tr>
        </thead>
        <tbody>
          {CF_TEMPLATE.map((row, idx) => {
            const values = fd.cfData.map(d => d[row.k]);
            return (
              <tr key={row.k} style={{ background: idx % 2 === 0 ? "rgba(0,0,0,.012)" : "transparent", borderBottom: "1px solid rgba(0,0,0,.03)" }}>
                <td style={{ padding: "5px 6px 5px " + (10 + row.d * 14) + "px", fontSize: 11, color: row.bold ? "#222" : "#555", fontWeight: row.bold ? 600 : 400, whiteSpace: "nowrap" }}>{row.l}</td>
                {values.map((v, i) => (
                  <td key={i} style={{ padding: "5px 8px", textAlign: "right", fontSize: 10, color: v < 0 ? "#c44040" : "#444", fontWeight: row.bold ? 600 : 400 }}>
                    {fmtFS(v)}
                  </td>
                ))}
                <td style={{ padding: "5px 4px", textAlign: "center" }}><Sparkline values={values} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ════════════════════════ PRICE CHART ════════════════════════ */
function PriceChart({ co, vc, price, wkLow, wkHigh }) {
  const [pricePeriod, setPricePeriod] = useState("3M");
  const [liveHist, setLiveHist] = useState(null);
  const [histStatus, setHistStatus] = useState("idle"); // idle | loading | live | error | nodata
  const [histInterval, setHistInterval] = useState("daily"); // "15min" | "1hour" | "daily"
  const [histSourceLabel, setHistSourceLabel] = useState("IBKR");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchHist(co.t, pricePeriod).then(r => {
      if (cancelled) return;
      setLoading(false);
      if (r.status === "live" && r.hist) {
        setLiveHist(r.hist);
        setHistStatus("live");
        setHistInterval(r.interval || "daily");
        setHistSourceLabel(r.sourceLabel || "IBKR");
      } else {
        setLiveHist(null);
        setHistStatus(r.status);
        setHistInterval("daily");
        setHistSourceLabel("IBKR");
      }
    });
    return () => { cancelled = true; };
  }, [co.t, pricePeriod]);

  const priceHistory = useMemo(() => {
    let base;
    let isLive = false;
    if (liveHist && liveHist.length > 0) {
      base = liveHist;
      isLive = true;
    } else {
      base = [];
    }
    const today = new Date();
    const isIntraday = histInterval === "15min" || histInterval === "1hour";
    const enriched = base.map((d, i) => {
      let label = d.date, full = d.fullDate, iso = d.isoDT;
      if (!full) {
        const dt = new Date(today);
        dt.setDate(dt.getDate() - Math.round((base.length - 1 - i) * 7 / 5));
        full = dt.toISOString().slice(0, 10);
        iso = full + "T16:00:00";
      }
      const dt = iso ? new Date(iso) : new Date(full);
      // Smarter label formatting based on period
      if (pricePeriod === "5Y") label = dt.getFullYear().toString();
      else if (pricePeriod === "1Y" || pricePeriod === "YTD" || pricePeriod === "6M") label = dt.toLocaleString("en-US", { month: "short" });
      else if (pricePeriod === "3M") label = (dt.getMonth() + 1) + "/" + dt.getDate();
      else if (pricePeriod === "1M") {
        // Intraday 1-hour bars — show date for first bar of each day
        if (i === 0 || base[i-1]?.fullDate !== d.fullDate) label = (dt.getMonth() + 1) + "/" + dt.getDate();
        else label = "";
      } else if (pricePeriod === "1W") {
        // Intraday 15-min bars — show weekday for first bar of each day
        if (i === 0 || base[i-1]?.fullDate !== d.fullDate) label = dt.toLocaleString("en-US", { weekday: "short" });
        else label = "";
      } else label = (dt.getMonth() + 1) + "/" + dt.getDate();
      return { ...d, date: label, fullDate: full, isoDT: iso };
    });
    // Pin the final bar to the current live price when the historical close is stale
    if (isLive && enriched.length > 0 && price > 0) {
      const last = enriched[enriched.length - 1];
      const todayISO = new Date().toISOString().slice(0, 10);
      if (!isIntraday && last.fullDate !== todayISO) {
        // Append a live-quote bar dated today
        enriched.push({ date: "now", fullDate: todayISO, isoDT: todayISO + "T16:00:00", price: +price.toFixed(2) });
      } else {
        // Same-day; replace last close with current quote for intraday accuracy
        enriched[enriched.length - 1] = { ...last, price: +price.toFixed(2) };
      }
    }
    return enriched;
  }, [histInterval, liveHist, price, pricePeriod]);

  const startPrice = priceHistory[0]?.price || price;
  const endPrice = priceHistory[priceHistory.length - 1]?.price || price;
  const periodReturn = priceHistory.length > 1 && startPrice > 0 ? ((endPrice - startPrice) / startPrice) * 100 : 0;
  const retColor = periodReturn >= 0 ? "#1a8a5c" : "#c44040";

  // Show 52-week ref lines only when period is long enough to be visually meaningful
  const showRefs = ["6M", "YTD", "1Y", "5Y"].includes(pricePeriod);
  const gradId = "priceGrad_" + co.t;

  // Compute a padded Y-axis domain so chart doesn't hug data edges.
  // Uses 3-5% padding around actual price range (larger range for volatile periods).
  const priceDomain = useMemo(() => {
    if (!priceHistory.length) return ["auto", "auto"];
    let min = Infinity, max = -Infinity;
    for (const d of priceHistory) {
      if (d.price < min) min = d.price;
      if (d.price > max) max = d.price;
    }
    // For short periods (intraday) use tight 2% pad; longer periods get 5%
    const padPct = pricePeriod === "1W" ? 0.02 : pricePeriod === "1M" ? 0.03 : 0.05;
    const range = max - min;
    const pad = Math.max(range * padPct, max * 0.005); // min pad = 0.5% of price
    return [Math.max(0, min - pad), max + pad];
  }, [priceHistory, pricePeriod]);

  // Precise tick placement — aim for ~6 labels with human-readable spacing
  const tickCount = pricePeriod === "5Y" ? 6 : pricePeriod === "1Y" ? 12 : 6;
  const tickInterval = priceHistory.length > 0 ? Math.max(1, Math.floor(priceHistory.length / tickCount)) : 1;

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload || !payload[0]) return null;
    const d = payload[0].payload;
    const chg = startPrice > 0 ? ((d.price - startPrice) / startPrice) * 100 : 0;
    const chgColor = chg >= 0 ? "#1a8a5c" : "#c44040";
    const isIntraday = histInterval === "15min" || histInterval === "1hour";
    const dt = d.isoDT ? new Date(d.isoDT) : d.fullDate ? new Date(d.fullDate) : null;
    const dateLabel = dt
      ? (isIntraday
          ? dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) + "  " + dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
          : dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }))
      : d.date;
    // Tighter price formatting: 2 decimals always; prices >$1000 show no decimals
    const priceStr = d.price >= 1000 ? "$" + d.price.toFixed(0) : "$" + d.price.toFixed(2);
    return (
      <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.1)", borderRadius: 6, padding: "6px 10px", boxShadow: "0 4px 12px rgba(0,0,0,.08)" }}>
        <div style={{ fontSize: 10, color: "#999", marginBottom: 2 }}>{dateLabel}</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#111", fontVariantNumeric: "tabular-nums" }}>{priceStr}</div>
        <div style={{ fontSize: 10, color: chgColor, fontWeight: 600, marginTop: 1, fontVariantNumeric: "tabular-nums" }}>
          {chg >= 0 ? "+" : ""}{chg.toFixed(2)}% vs {pricePeriod} start
        </div>
      </div>
    );
  };

  const periods = ["1W", "1M", "3M", "6M", "YTD", "1Y", "5Y"];

  return (
    <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 10, padding: "12px 14px", boxShadow: "0 1px 3px rgba(0,0,0,.03)" }}>
      {/* Header: label left, period selector right */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#aaa", letterSpacing: 1.5, textTransform: "uppercase" }}>Price history</div>
        <div style={{ display: "flex", gap: 1, background: "rgba(0,0,0,.03)", borderRadius: 5, padding: 2 }}>
          {periods.map(p => (
            <button key={p} onClick={() => setPricePeriod(p)} style={{
              background: pricePeriod === p ? "#fff" : "transparent",
              border: "none", borderRadius: 3, padding: "2px 8px", fontSize: 10,
              color: pricePeriod === p ? vc.c : "#888", cursor: "pointer", fontWeight: 700, letterSpacing: 0.3,
              boxShadow: pricePeriod === p ? "0 1px 2px rgba(0,0,0,.08)" : "none",
            }}>{p}</button>
          ))}
        </div>
      </div>

      {/* Price summary row */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 10 }}>
        <span style={{ fontSize: 26, fontWeight: 700, color: "#111", letterSpacing: -0.5, fontVariantNumeric: "tabular-nums" }}>
          {endPrice >= 1000 ? "$" + endPrice.toFixed(0) : "$" + endPrice.toFixed(2)}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 14, background: periodReturn >= 0 ? "rgba(26,138,92,.1)" : "rgba(196,64,64,.1)", fontSize: 12, fontWeight: 700, color: retColor, fontVariantNumeric: "tabular-nums" }}>
          <span>{periodReturn >= 0 ? "▲" : "▼"}</span>
          <span>{periodReturn >= 0 ? "+" : ""}{periodReturn.toFixed(2)}%</span>
          <span style={{ fontSize: 10, fontWeight: 500, opacity: 0.7, marginLeft: 2 }}>over {pricePeriod}</span>
        </span>
        {/* Data status pill — shows interval (15m/1h/D) for live intraday */}
        {(() => {
          const intervalLabel = histInterval === "15min" ? " · 15M" : histInterval === "1hour" ? " · 1H" : histInterval === "daily" ? " · DAILY" : "";
          const pill = loading ? { label: "LOADING", bg: "rgba(184,134,11,.1)", fg: "#b8860b", dot: "#b8860b" }
            : histStatus === "live" ? { label: `${histSourceLabel}${intervalLabel}`, bg: "rgba(26,138,92,.1)", fg: "#1a8a5c", dot: "#1a8a5c", pulse: true }
            : histStatus === "error" ? { label: "BROKER UNAVAILABLE", bg: "rgba(196,64,64,.08)", fg: "#c44040", dot: "#c44040" }
            : histStatus === "nodata" ? { label: "NO BROKER DATA", bg: "rgba(0,0,0,.04)", fg: "#888", dot: "#888" }
            : { label: "WAITING", bg: "rgba(0,0,0,.04)", fg: "#888", dot: "#aaa" };
          return (
            <span title={histStatus === "live" ? `${histSourceLabel} ${histInterval} price history via broker connectivity` : "Broker history is unavailable for this symbol and period."} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 10, background: pill.bg, fontSize: 9, fontWeight: 700, color: pill.fg, letterSpacing: 0.5 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: pill.dot, animation: pill.pulse ? "pulse 1.8s ease-in-out infinite" : "none" }} />
              {pill.label}
            </span>
          );
        })()}
        <span style={{ marginLeft: "auto", fontSize: 10, color: "#999", fontVariantNumeric: "tabular-nums" }}>
          52w range: <span style={{ color: "#666", fontWeight: 600 }}>${wkLow.toFixed(2)}</span> – <span style={{ color: "#666", fontWeight: 600 }}>${wkHigh.toFixed(2)}</span>
        </span>
      </div>

      {/* Chart body */}
      <div style={{ position: "relative", height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={priceHistory} margin={{ top: 8, right: showRefs ? 42 : 8, bottom: 4, left: -2 }}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={vc.c} stopOpacity={0.28} />
                <stop offset="100%" stopColor={vc.c} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#999" }} axisLine={{ stroke: "#eee" }} tickLine={false} interval={tickInterval} minTickGap={8} />
            <YAxis
              tick={{ fontSize: 10, fill: "#aaa", fontVariantNumeric: "tabular-nums" }}
              axisLine={false} tickLine={false}
              domain={priceDomain}
              tickCount={6}
              tickFormatter={v => {
                if (v >= 1000) return "$" + Math.round(v).toLocaleString();
                if (v >= 100) return "$" + v.toFixed(0);
                if (v >= 10) return "$" + v.toFixed(1);
                return "$" + v.toFixed(2);
              }}
              width={52}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: vc.c, strokeWidth: 1, strokeDasharray: "3 3", strokeOpacity: 0.5 }} />
            {showRefs && (
              <ReferenceLine y={wkHigh} stroke="#999" strokeDasharray="4 4" strokeOpacity={0.5}
                label={{ value: "52w hi $" + wkHigh.toFixed(0), position: "right", fill: "#999", fontSize: 9 }} />
            )}
            {showRefs && (
              <ReferenceLine y={wkLow} stroke="#999" strokeDasharray="4 4" strokeOpacity={0.5}
                label={{ value: "52w lo $" + wkLow.toFixed(0), position: "right", fill: "#999", fontSize: 9 }} />
            )}
            {/* Linear interpolation — more faithful to actual price action than monotone smoothing */}
            <Area type="linear" dataKey="price" stroke={vc.c} strokeWidth={1.6} fill={"url(#" + gradId + ")"} dot={false} activeDot={{ r: 4, fill: vc.c, stroke: "#fff", strokeWidth: 2 }} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
        {!loading && priceHistory.length === 0 ? (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <div style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(0,0,0,.08)", background: "rgba(255,255,255,.92)", boxShadow: "0 6px 20px rgba(0,0,0,.06)", textAlign: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#444", letterSpacing: 0.4 }}>Broker chart unavailable</div>
              <div style={{ marginTop: 4, fontSize: 10, color: "#888" }}>No broker bars returned for {co.t} over {pricePeriod}.</div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ════════════════════════ CATALYST CALENDAR ════════════════════════ */
// Full-screen view — shows upcoming earnings across all tickers in our universe.
// Fetches FMP earnings calendar for next 90 days on mount, cross-references with COMPANIES,
// groups by date, and renders clickable rows.

function CalendarView({ cos, liveData, apiKey, onSelect, themes }) {
  const [entries, setEntries] = useState(null); // null = loading, [] = no data, [...] = loaded
  const [rangeFilter, setRangeFilter] = useState("30d"); // "7d" | "30d" | "90d"
  const [themeFilter, setThemeFilter] = useState(null);  // null | theme id

  // Compute from/to in ISO date format
  const today = new Date();
  const pad = n => String(n).padStart(2, "0");
  const isoDate = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const fromDate = isoDate(today);
  const toDate90 = new Date(today); toDate90.setDate(toDate90.getDate() + 90);
  const toDate = isoDate(toDate90);

  useEffect(() => {
    if (!apiKey) { setEntries([]); return; }
    setEntries(null);
    fetchEarningsCalendar(fromDate, toDate, apiKey).then(data => {
      if (!data) { setEntries([]); return; }
      // Build a set of internal tickers we track — include both native + FMP-mapped symbols
      const universeSet = new Set(cos.map(c => c.t));
      // Filter: only keep entries whose internalTicker is in our universe
      const filtered = data.filter(e => universeSet.has(e.internalTicker));
      setEntries(filtered);
    });
  }, [apiKey]);

  // Apply range filter
  const rangeDays = rangeFilter === "7d" ? 7 : rangeFilter === "30d" ? 30 : 90;
  const rangeCutoff = new Date(today); rangeCutoff.setDate(rangeCutoff.getDate() + rangeDays);
  const rangeCutoffISO = isoDate(rangeCutoff);

  const visible = useMemo(() => {
    if (!entries) return [];
    let rows = entries.filter(e => e.date <= rangeCutoffISO);
    // Apply theme filter
    if (themeFilter) {
      rows = rows.filter(e => {
        const co = cos.find(c => c.t === e.internalTicker);
        return co && co.themes && co.themes.includes(themeFilter);
      });
    }
    // Sort by date asc, then by time of day (bmo before amc)
    rows.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      const aTime = a.time === "bmo" ? 0 : a.time === "amc" ? 2 : 1;
      const bTime = b.time === "bmo" ? 0 : b.time === "amc" ? 2 : 1;
      return aTime - bTime;
    });
    return rows;
  }, [entries, rangeCutoffISO, themeFilter, cos]);

  // Group by date
  const grouped = useMemo(() => {
    const out = [];
    let currentDate = null;
    let currentGroup = null;
    visible.forEach(e => {
      if (e.date !== currentDate) {
        currentGroup = { date: e.date, rows: [] };
        out.push(currentGroup);
        currentDate = e.date;
      }
      currentGroup.rows.push(e);
    });
    return out;
  }, [visible]);

  const fmtDateHeader = iso => {
    const d = new Date(iso + "T12:00:00");
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const dayDiff = Math.round((d - today) / (1000 * 60 * 60 * 24));
    const relLabel = dayDiff === 0 ? "Today" : dayDiff === 1 ? "Tomorrow" : dayDiff < 7 ? "In " + dayDiff + " days" : null;
    return {
      primary: days[d.getDay()] + ", " + months[d.getMonth()] + " " + d.getDate(),
      rel: relLabel,
    };
  };

  const timeBadge = t => {
    if (t === "bmo") return { label: "BMO", bg: "rgba(91,140,42,.15)", fg: "#5b8c2a", title: "Before market open" };
    if (t === "amc") return { label: "AMC", bg: "rgba(142,68,173,.15)", fg: "#8e44ad", title: "After market close" };
    if (t === "dmh") return { label: "DMH", bg: "rgba(205,162,78,.15)", fg: "#b8860b", title: "During market hours" };
    return { label: "—", bg: "rgba(0,0,0,.04)", fg: "#999", title: "Time not specified" };
  };

  const fmtEPS = n => (n == null || isNaN(n)) ? "—" : (n >= 0 ? "$" : "–$") + Math.abs(n).toFixed(2);
  const fmtRev = n => {
    if (n == null) return "—";
    const abs = Math.abs(n);
    if (abs >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
    if (abs >= 1e6) return "$" + (n / 1e6).toFixed(0) + "M";
    return "$" + n;
  };
  const accent = "#CDA24E";

  return (
    <div style={{ animation: "fadeIn 0.3s ease" }}>
      {/* ── HEADER ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 11, color: accent, letterSpacing: 5, textTransform: "uppercase", fontWeight: 600 }}>
            Earnings & Catalysts
          </div>
          <h2 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 30, fontWeight: 400, color: "#111", letterSpacing: -0.8, lineHeight: 1.05, marginTop: 3 }}>
            Catalyst Calendar
          </h2>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: accent }}>
            {entries === null ? "…" : visible.length}
          </div>
          <div style={{ fontSize: 10, color: "#aaa", letterSpacing: 0.3 }}>
            scheduled next {rangeFilter === "7d" ? "week" : rangeFilter === "30d" ? "30 days" : "90 days"}
          </div>
        </div>
      </div>

      {/* ── FILTERS ── */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", gap: 2, background: "rgba(0,0,0,.03)", borderRadius: 7, padding: 2 }}>
          {[["7d", "7 days"], ["30d", "30 days"], ["90d", "90 days"]].map(([k, lb]) => (
            <button key={k} onClick={() => setRangeFilter(k)} style={{
              background: rangeFilter === k ? "#fff" : "transparent",
              border: "none", borderRadius: 5, padding: "5px 12px",
              fontSize: 11, fontWeight: rangeFilter === k ? 700 : 500,
              color: rangeFilter === k ? "#111" : "#888", cursor: "pointer",
              boxShadow: rangeFilter === k ? "0 1px 3px rgba(0,0,0,.06)" : "none",
              transition: "all .12s",
            }}>{lb}</button>
          ))}
        </div>

        {/* Theme filter */}
        <div style={{ display: "inline-flex", gap: 3, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: "#bbb", letterSpacing: .5, textTransform: "uppercase", marginRight: 4 }}>Theme:</span>
          <button onClick={() => setThemeFilter(null)} style={{
            background: !themeFilter ? "#fff" : "transparent",
            border: !themeFilter ? "1px solid rgba(0,0,0,.1)" : "1px solid transparent",
            borderRadius: 5, padding: "4px 10px", fontSize: 10,
            color: !themeFilter ? "#111" : "#999", cursor: "pointer", fontWeight: 600,
          }}>All</button>
          {Object.keys(themes).filter(id => themes[id].available).map(tid => {
            const t = themes[tid];
            const active = themeFilter === tid;
            return (
              <button key={tid} onClick={() => setThemeFilter(active ? null : tid)} style={{
                background: active ? "#fff" : "transparent",
                border: active ? `1px solid ${t.accent}66` : "1px solid transparent",
                borderRadius: 5, padding: "4px 9px", fontSize: 10,
                color: active ? t.accent : "#888", cursor: "pointer", fontWeight: active ? 700 : 500,
                display: "inline-flex", alignItems: "center", gap: 3,
                boxShadow: active ? `0 1px 3px ${t.accent}22` : "none",
              }}>
                <span style={{ fontSize: 9 }}>{t.icon}</span>
                {t.title.replace(/^The /, "")}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── STATE: LOADING / NO KEY / EMPTY / LIST ── */}
      {!apiKey && (
        <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 10, padding: "30px 20px", textAlign: "center", color: "#888", fontSize: 12 }}>
          <div style={{ fontSize: 32, opacity: 0.3, marginBottom: 8 }}>🔑</div>
          <div style={{ fontWeight: 600, marginBottom: 4, color: "#555" }}>FMP API key required</div>
          <div style={{ fontSize: 11, color: "#999" }}>Add a key in settings (gear icon) to load the earnings calendar.</div>
        </div>
      )}

      {apiKey && entries === null && (
        <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 10, padding: "30px 20px", textAlign: "center", color: "#888", fontSize: 12 }}>
          <div style={{ fontSize: 11, color: "#b8860b", marginBottom: 6 }}>⌛ Fetching calendar…</div>
          <div style={{ fontSize: 10, color: "#aaa" }}>Calling FMP earnings calendar endpoint for next 90 days.</div>
        </div>
      )}

      {apiKey && entries && entries.length === 0 && (
        <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 10, padding: "30px 20px", textAlign: "center", color: "#888", fontSize: 12 }}>
          <div style={{ fontSize: 32, opacity: 0.3, marginBottom: 8 }}>📅</div>
          <div style={{ fontWeight: 600, marginBottom: 4, color: "#555" }}>No earnings data returned</div>
          <div style={{ fontSize: 11, color: "#999" }}>Either no companies in our universe report in the next 90 days, or the API response was empty.</div>
        </div>
      )}

      {apiKey && entries && entries.length > 0 && grouped.length === 0 && (
        <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 10, padding: "30px 20px", textAlign: "center", color: "#888", fontSize: 12 }}>
          <div style={{ fontSize: 11, color: "#aaa" }}>No events match the current filters — try widening the range or clearing the theme filter.</div>
        </div>
      )}

      {/* ── GROUPED EVENTS ── */}
      {grouped.map(group => {
        const dh = fmtDateHeader(group.date);
        return (
          <div key={group.date} style={{ marginBottom: 14 }}>
            {/* Date header */}
            <div style={{
              position: "sticky", top: 0, zIndex: 2,
              display: "flex", alignItems: "baseline", gap: 8,
              padding: "5px 8px", background: "linear-gradient(to bottom, #fff 75%, rgba(255,255,255,.85))",
              borderBottom: "1px solid rgba(0,0,0,.08)",
            }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#222" }}>{dh.primary}</span>
              {dh.rel && <span style={{ fontSize: 10, color: accent, fontWeight: 600, letterSpacing: .3 }}>{dh.rel}</span>}
              <span style={{ fontSize: 10, color: "#bbb", marginLeft: "auto" }}>{group.rows.length} event{group.rows.length !== 1 ? "s" : ""}</span>
            </div>
            {/* Rows */}
            <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.05)", borderTop: "none", borderRadius: "0 0 8px 8px", overflow: "hidden" }}>
              {group.rows.map((row, i) => {
                const co = cos.find(c => c.t === row.internalTicker);
                if (!co) return null;
                const vc = VX[co.v];
                const tb = timeBadge(row.time);
                const epsActual = row.eps;
                const epsEst = row.epsEstimated;
                const revEst = row.revenueEstimated;
                const reported = epsActual != null;
                const beat = reported && epsEst != null && epsActual >= epsEst;
                // Build theme chips
                const themeChips = (co.themes || []).slice(0, 2).map(tid => themes[tid]).filter(Boolean);

                return (
                  <div key={row.internalTicker + "-" + i} onClick={() => onSelect(row.internalTicker)}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "52px 1fr auto auto auto",
                      gap: 12, alignItems: "center",
                      padding: "9px 10px",
                      borderBottom: i < group.rows.length - 1 ? "1px solid rgba(0,0,0,.04)" : "none",
                      background: i % 2 ? "rgba(0,0,0,.008)" : "transparent",
                      cursor: "pointer",
                      transition: "background .12s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = vc.bg}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 ? "rgba(0,0,0,.008)" : "transparent"}
                  >
                    {/* Time badge */}
                    <span title={tb.title} style={{
                      display: "inline-block", padding: "2px 5px", borderRadius: 3,
                      background: tb.bg, color: tb.fg, fontSize: 9, fontWeight: 700, letterSpacing: .5, textAlign: "center",
                    }}>{tb.label}</span>

                    {/* Ticker + name + theme */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <Logo ticker={co.t} size={18} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: vc.c }}>{co.cc} {co.t}</span>
                          <span style={{ fontSize: 10, color: "#999", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 220 }}>{co.nm}</span>
                        </div>
                        {themeChips.length > 0 && (
                          <div style={{ display: "flex", gap: 3, marginTop: 2 }}>
                            {themeChips.map(t => (
                              <span key={t.id} style={{
                                fontSize: 8, padding: "0 4px", borderRadius: 2,
                                background: t.accent + "15", color: t.accent, fontWeight: 600, letterSpacing: .3,
                              }}>{t.title.replace(/^The /, "")}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* EPS est (or actual if reported) */}
                    <div style={{ textAlign: "right", minWidth: 80 }}>
                      <div style={{ fontSize: 9, color: "#bbb", letterSpacing: .3, textTransform: "uppercase" }}>
                        {reported ? "EPS Act" : "EPS Est"}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: reported ? (beat ? "#1a8a5c" : "#c44040") : "#333" }}>
                        {reported ? fmtEPS(epsActual) : fmtEPS(epsEst)}
                      </div>
                      {reported && epsEst != null && (
                        <div style={{ fontSize: 9, color: "#999" }}>est {fmtEPS(epsEst)}</div>
                      )}
                    </div>

                    {/* Rev est */}
                    <div style={{ textAlign: "right", minWidth: 70 }}>
                      <div style={{ fontSize: 9, color: "#bbb", letterSpacing: .3, textTransform: "uppercase" }}>Rev Est</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#333" }}>{fmtRev(revEst)}</div>
                    </div>

                    {/* Arrow indicator */}
                    <span style={{ fontSize: 14, color: "#ccc" }}>›</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Footer */}
      {grouped.length > 0 && (
        <div style={{ fontSize: 10, color: "#bbb", marginTop: 12, textAlign: "center" }}>
          Calendar data: FMP · Cached 1 hour · Click any row to open detail panel
        </div>
      )}
    </div>
  );
}

/* ════════════════════════ PEER COMPARISON TABLE ════════════════════════ */
// Renders focal company + up to 7 peers from co.cp array in a table.
// Columns: Ticker, Mkt Cap, P/E, Rev TTM, GM %, Beta, Off 52w-High %.
// Data sourcing (per cell): live > fundCache > authored. Color dot indicates freshness.
// Click non-focal row → onSelect(ticker) to switch detail panel.

function PeerTable({ co, liveData, liveHist = {}, apiKey, onSelect, accent }) {
  const [fundData, setFundData] = useState({}); // { ticker: fundCache.data | null | "loading" }

  // Build peer list: focal + up-to-7 from cp. Separate in-universe vs pvt vs unknown.
  const peerTickers = useMemo(() => {
    const raw = (co.cp || []).slice(0, 8);
    const peers = raw.map(str => {
      // Match "(pvt)" marker anywhere
      const isPvt = /\(pvt\)|\(private\)/i.test(str);
      // Strip parenthetical, trim
      const rawTicker = str.replace(/\(.*?\)/g, "").trim();
      const inUniverse = COMPANIES.find(c => c.t === rawTicker);
      return { raw: str, ticker: rawTicker, isPvt, inUniverse };
    });
    return [{ raw: co.t, ticker: co.t, isPvt: false, inUniverse: co, focal: true }, ...peers];
  }, [co.t, co.cp]);

  // Trigger lazy fetch for focal + in-universe peers on mount / co change
  useEffect(() => {
    if (!apiKey) return;
    const toFetch = peerTickers
      .filter(p => p.inUniverse && !p.isPvt)
      .map(p => p.ticker);
    toFetch.forEach(t => {
      setFundData(prev => prev[t] !== undefined ? prev : { ...prev, [t]: "loading" });
      const shares = liveData[t]?.sharesOut;
      fetchFund(t, apiKey, shares).then(data => {
        setFundData(prev => ({ ...prev, [t]: data }));
      });
    });
  }, [co.t, apiKey]);

  const fmt = {
    mc: n => n == null ? "—" : n >= 1e6 ? "$" + (n / 1e6).toFixed(1) + "T" : n >= 1e3 ? "$" + (n / 1e3).toFixed(0) + "B" : "$" + n + "M",
    pe: n => (n == null || isNaN(n)) ? "—" : n < 0 ? "n/m" : n.toFixed(1),
    rev: n => n == null ? "—" : n >= 1e3 ? "$" + (n / 1e3).toFixed(1) + "B" : "$" + n + "M",
    pct: n => n == null ? "—" : (n >= 0 ? "+" : "") + n.toFixed(1) + "%",
    beta: n => (n == null || isNaN(n)) ? "—" : n.toFixed(2),
  };

  // Compute row data — live > fundCache > authored fallback
  const rows = peerTickers.map(p => {
    if (p.isPvt) {
      return { ...p, label: p.ticker || p.raw, mc: null, pe: null, rev: null, gm: null, beta: null, off52: null, status: "pvt" };
    }
    if (!p.inUniverse) {
      return { ...p, label: p.ticker || p.raw, mc: null, pe: null, rev: null, gm: null, beta: null, off52: null, status: "unknown" };
    }
    const c = p.inUniverse;
    const live = liveData[c.t] || {};
    const fund = fundData[c.t];
    const mc = live.mc != null ? live.mc : c.mc;
    const pe = live.pe != null ? live.pe : c.pe;
    const price = live.price;
    const yrHigh = live.yearHigh;
    const off52 = (price != null && yrHigh) ? ((price - yrHigh) / yrHigh) * 100 : null;
    const rev = fund && fund !== "loading" && fund.revenueTTM != null ? fund.revenueTTM : c.r;
    const gm = fund && fund !== "loading" && fund.grossMarginTTM != null ? fund.grossMarginTTM : c.g;
    const beta = fund && fund !== "loading" && fund.beta != null ? fund.beta : c.fin?.beta;
    const isLoading = fund === "loading";
    return {
      ...p, label: c.t, name: c.nm, cc: c.cc,
      mc, pe, rev, gm, beta, off52, isLoading,
      status: "ok",
      liveFields: { mc: live.mc != null, pe: live.pe != null, off52: off52 != null },
      ttmFields: { rev: fund && fund !== "loading" && fund.revenueTTM != null, gm: fund && fund !== "loading" && fund.grossMarginTTM != null, beta: fund && fund !== "loading" && fund.beta != null },
    };
  });
  const thStyle = { textAlign: "right", padding: "6px 7px", fontSize: 9, color: "#aaa", fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" };
  const thLeft = { ...thStyle, textAlign: "left" };
  const cellBase = { padding: "7px 7px", fontSize: 11, color: "#222", textAlign: "right", whiteSpace: "nowrap" };

  // Live-data indicator — tiny dot that signals the cell is sourced from live API (not authored fallback)
  const Dot = ({ live }) => (
    <span title={live ? "Live" : "Authored fallback"} style={{ display: "inline-block", width: 4, height: 4, borderRadius: 2, background: live ? "#1a8a5c" : "rgba(0,0,0,.12)", marginLeft: 4, verticalAlign: "middle" }} />
  );

  return (
    <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 8, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "rgba(0,0,0,.018)", borderBottom: "1px solid rgba(0,0,0,.06)" }}>
            <th style={thLeft}>Peer</th>
            <th style={thStyle}>Mkt Cap</th>
            <th style={thStyle}>P/E</th>
            <th style={thStyle}>Rev TTM</th>
            <th style={thStyle}>GM %</th>
            <th style={thStyle}>Beta</th>
            <th style={thStyle}>Off 52w-Hi</th>
            <th style={{ ...thStyle, textAlign: "center" }}>1M trend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const clickable = !r.focal && r.status === "ok";
            const rowBg = r.focal ? `${accent}12` : (i % 2 ? "rgba(0,0,0,.012)" : "transparent");
            const rowStyle = {
              borderBottom: i < rows.length - 1 ? "1px solid rgba(0,0,0,.04)" : "none",
              background: rowBg,
              cursor: clickable ? "pointer" : "default",
              opacity: r.status === "ok" ? 1 : 0.55,
              transition: "background .12s",
            };
            const leftCell = { ...cellBase, textAlign: "left", fontWeight: r.focal ? 700 : 500, color: r.focal ? "#111" : "#333" };
            return (
              <tr key={r.ticker + "-" + i} style={rowStyle}
                  onClick={() => { if (clickable) onSelect(r.ticker); }}
                  onMouseEnter={e => { if (clickable) e.currentTarget.style.background = `${accent}20`; }}
                  onMouseLeave={e => { e.currentTarget.style.background = rowBg; }}>
                <td style={leftCell}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {r.status === "ok" && <Logo ticker={r.ticker} size={14} />}
                    <span style={{ fontSize: 11, fontWeight: r.focal ? 700 : 600 }}>
                      {r.cc ? r.cc + " " : ""}{r.label}
                    </span>
                    {r.focal && <span style={{ fontSize: 9, padding: "1px 5px", background: accent, color: "#fff", borderRadius: 3, letterSpacing: .5, fontWeight: 700 }}>FOCAL</span>}
                    {r.status === "pvt" && <span style={{ fontSize: 9, color: "#999", fontStyle: "italic" }}>(private)</span>}
                    {r.status === "unknown" && <span style={{ fontSize: 9, color: "#999", fontStyle: "italic" }}>(not covered)</span>}
                  </span>
                  {r.name && <div style={{ fontSize: 9, color: "#999", marginTop: 1, fontWeight: 400 }}>{r.name.length > 32 ? r.name.slice(0, 32) + "…" : r.name}</div>}
                </td>
                <td style={cellBase}>
                  {fmt.mc(r.mc)}
                  {r.status === "ok" && <Dot live={r.liveFields?.mc} />}
                </td>
                <td style={cellBase}>
                  {fmt.pe(r.pe)}
                  {r.status === "ok" && <Dot live={r.liveFields?.pe} />}
                </td>
                <td style={cellBase}>
                  {r.isLoading ? <span style={{ color: "#bbb" }}>…</span> : fmt.rev(r.rev)}
                  {r.status === "ok" && !r.isLoading && <Dot live={r.ttmFields?.rev} />}
                </td>
                <td style={cellBase}>
                  {r.isLoading ? <span style={{ color: "#bbb" }}>…</span> : (r.gm == null ? "—" : r.gm.toFixed(0) + "%")}
                  {r.status === "ok" && !r.isLoading && <Dot live={r.ttmFields?.gm} />}
                </td>
                <td style={cellBase}>
                  {r.isLoading ? <span style={{ color: "#bbb" }}>…</span> : fmt.beta(r.beta)}
                  {r.status === "ok" && !r.isLoading && <Dot live={r.ttmFields?.beta} />}
                </td>
                <td style={{ ...cellBase, color: r.off52 != null && r.off52 < -20 ? "#c44040" : r.off52 != null && r.off52 > -5 ? "#1a8a5c" : "#222" }}>
                  {fmt.pct(r.off52)}
                  {r.status === "ok" && <Dot live={r.liveFields?.off52} />}
                </td>
                <td style={{ padding: "4px 8px", textAlign: "center", verticalAlign: "middle" }}>
                  {r.status === "ok" ? (
                    liveHist[r.ticker] && liveHist[r.ticker].length >= 2 ? (
                      <PriceSparkline data={liveHist[r.ticker]} width={72} height={22} />
                    ) : (
                      <span style={{ color: "#ccc", fontSize: 9 }}>loading…</span>
                    )
                  ) : <span style={{ color: "#ccc", fontSize: 10 }}>—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ padding: "5px 8px", fontSize: 9, color: "#bbb", background: "rgba(0,0,0,.01)", borderTop: "1px solid rgba(0,0,0,.04)", letterSpacing: .3 }}>
        <span style={{ display: "inline-block", width: 4, height: 4, borderRadius: 2, background: "#1a8a5c", marginRight: 4, verticalAlign: "middle" }} />
        Live dots = platform or research APIs · Click a peer row to switch focus · TTM = trailing twelve months · Private/uncovered names shown without metrics
      </div>
    </div>
  );
}

/* ════════════════════════ FILINGS + TRANSCRIPTS TAB ════════════════════════ */
// Shows recent SEC filings (10-K, 10-Q, 8-K, S-1, DEF 14A, etc.) + latest earnings transcript
// for the focal company. Filings list is clickable → opens the SEC EDGAR link in a new tab.
// Transcript defaults to most-recent quarter but has a dropdown to jump to historical calls.

function FilingsTab({ co, apiKey }) {
  const [filings, setFilings] = useState(null); // null = loading, [] = empty, [...] = loaded
  const [transcriptList, setTranscriptList] = useState(null); // [[year, quarter, date], ...]
  const [selectedQY, setSelectedQY] = useState(null); // [quarter, year] or null for latest
  const [transcript, setTranscript] = useState(null); // {symbol, quarter, year, date, content, ...} or null
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);
  const [filingTypeFilter, setFilingTypeFilter] = useState("all"); // "all" | "10K" | "10Q" | "8K" | "other"
  // Fetch filings + transcript list on mount
  useEffect(() => {
    if (!apiKey) { setFilings([]); setTranscriptList([]); return; }
    setFilings(null);
    setTranscript(null);
    setTranscriptList(null);
    setSelectedQY(null);
    fetchSECFilings(co.t, apiKey).then(data => setFilings(data || []));
    fetchTranscriptList(co.t, apiKey).then(data => setTranscriptList(data || []));
    // Auto-fetch latest transcript
    setTranscriptLoading(true);
    fetchTranscript(co.t, apiKey).then(data => {
      setTranscript(data);
      setTranscriptLoading(false);
    });
  }, [co.t, apiKey]);

  // Fetch specific transcript when user picks a quarter
  const loadTranscript = (quarter, year) => {
    setTranscriptLoading(true);
    setTranscript(null);
    setSelectedQY([quarter, year]);
    setTranscriptExpanded(false);
    fetchTranscript(co.t, apiKey, quarter, year).then(data => {
      setTranscript(data);
      setTranscriptLoading(false);
    });
  };

  // Normalize filing type → category
  const filingCategory = (type) => {
    if (!type) return "other";
    const t = type.toUpperCase();
    if (t.includes("10-K") || t === "10K") return "10K";
    if (t.includes("10-Q") || t === "10Q") return "10Q";
    if (t.includes("8-K") || t === "8K") return "8K";
    return "other";
  };

  const filteredFilings = useMemo(() => {
    if (!filings) return [];
    if (filingTypeFilter === "all") return filings;
    return filings.filter(f => filingCategory(f.type) === filingTypeFilter);
  }, [filings, filingTypeFilter]);

  // Badge color per filing category
  const typeBadge = (type) => {
    const cat = filingCategory(type);
    if (cat === "10K") return { bg: "rgba(196,64,64,.12)", fg: "#c44040" };
    if (cat === "10Q") return { bg: "rgba(94,148,232,.12)", fg: "#5e94e8" };
    if (cat === "8K") return { bg: "rgba(184,134,11,.12)", fg: "#b8860b" };
    return { bg: "rgba(0,0,0,.04)", fg: "#888" };
  };

  const fmtDate = (iso) => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return months[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
    } catch(e) { return iso; }
  };

  // Split transcript content into prepared remarks vs Q&A if possible
  const transcriptSections = useMemo(() => {
    if (!transcript?.content) return null;
    const content = transcript.content;
    // Heuristic: look for common Q&A markers
    const qaMarkers = [
      /\b(Question-and-Answer Session|Q\s*&\s*A|QUESTIONS AND ANSWERS|Operator:.*Our first question)/i,
    ];
    let splitIdx = -1;
    for (const re of qaMarkers) {
      const m = re.exec(content);
      if (m && m.index > 1000) { splitIdx = m.index; break; }
    }
    if (splitIdx > 0) {
      return {
        prepared: content.slice(0, splitIdx).trim(),
        qa: content.slice(splitIdx).trim(),
      };
    }
    return { prepared: content, qa: null };
  }, [transcript]);

  return (
    <>
      {/* ══════════════════ SEC FILINGS ══════════════════ */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
          <div style={STYLE_LABEL}>SEC Filings · Recent</div>
          <div style={{ display: "inline-flex", gap: 2, background: "rgba(0,0,0,.03)", borderRadius: 5, padding: 2 }}>
            {[["all", "All"], ["10K", "10-K"], ["10Q", "10-Q"], ["8K", "8-K"], ["other", "Other"]].map(([k, lb]) => (
              <button key={k} onClick={() => setFilingTypeFilter(k)} style={{
                background: filingTypeFilter === k ? "#fff" : "transparent",
                border: "none", borderRadius: 3, padding: "3px 8px",
                fontSize: 10, fontWeight: filingTypeFilter === k ? 700 : 500,
                color: filingTypeFilter === k ? "#111" : "#888", cursor: "pointer",
                boxShadow: filingTypeFilter === k ? "0 1px 2px rgba(0,0,0,.06)" : "none",
              }}>{lb}</button>
            ))}
          </div>
        </div>

        {!apiKey && (
          <div style={{ padding: "20px 12px", background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 8, textAlign: "center", color: "#888", fontSize: 11 }}>
            Add FMP API key in settings to load SEC filings
          </div>
        )}
        {apiKey && filings === null && (
          <div style={{ padding: "20px 12px", background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 8, textAlign: "center", color: "#b8860b", fontSize: 11 }}>
            ⌛ Loading filings…
          </div>
        )}
        {apiKey && filings && filings.length === 0 && (
          <div style={{ padding: "20px 12px", background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 8, textAlign: "center", color: "#999", fontSize: 11 }}>
            No filings data returned for {co.t} {co.cc?.includes("🇺🇸") ? "" : "(foreign issuer — SEC filings may be limited)"}
          </div>
        )}
        {apiKey && filteredFilings.length > 0 && (
          <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 8, overflow: "hidden", maxHeight: 280, overflowY: "auto" }}>
            {filteredFilings.map((f, i) => {
              const badge = typeBadge(f.type);
              return (
                <a key={f.fillingDate + "-" + i} href={f.finalLink || f.link} target="_blank" rel="noopener noreferrer"
                   style={{
                     display: "grid", gridTemplateColumns: "60px 95px 1fr auto",
                     gap: 10, alignItems: "center",
                     padding: "7px 10px",
                     borderBottom: i < filteredFilings.length - 1 ? "1px solid rgba(0,0,0,.04)" : "none",
                     background: i % 2 ? "rgba(0,0,0,.008)" : "transparent",
                     textDecoration: "none", color: "inherit", cursor: "pointer",
                     transition: "background .12s",
                   }}
                   onMouseEnter={e => e.currentTarget.style.background = "rgba(205,162,78,.06)"}
                   onMouseLeave={e => e.currentTarget.style.background = i % 2 ? "rgba(0,0,0,.008)" : "transparent"}>
                  <span style={{ display: "inline-block", padding: "2px 5px", borderRadius: 3, background: badge.bg, color: badge.fg, fontSize: 9, fontWeight: 700, letterSpacing: .3, textAlign: "center" }}>{f.type}</span>
                  <span style={{ fontSize: 10, color: "#888" }}>{fmtDate(f.fillingDate || f.filingDate)}</span>
                  <span style={{ fontSize: 11, color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.type?.includes("10-K") ? "Annual Report" :
                     f.type?.includes("10-Q") ? "Quarterly Report" :
                     f.type?.includes("8-K") ? "Current Report" :
                     f.type?.includes("DEF 14A") ? "Proxy Statement" :
                     f.type?.includes("S-1") ? "Registration Statement" :
                     f.type || "Filing"}
                  </span>
                  <span style={{ fontSize: 14, color: "#ccc" }}>↗</span>
                </a>
              );
            })}
          </div>
        )}
      </div>

      {/* ══════════════════ EARNINGS TRANSCRIPT ══════════════════ */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
          <div style={STYLE_LABEL}>Earnings Call Transcript</div>
          {transcriptList && transcriptList.length > 0 && (
            <select
              value={selectedQY ? `${selectedQY[0]}-${selectedQY[1]}` : "latest"}
              onChange={e => {
                if (e.target.value === "latest") {
                  setSelectedQY(null);
                  setTranscriptLoading(true);
                  setTranscript(null);
                  setTranscriptExpanded(false);
                  fetchTranscript(co.t, apiKey).then(data => {
                    setTranscript(data);
                    setTranscriptLoading(false);
                  });
                } else {
                  const [q, y] = e.target.value.split("-").map(Number);
                  loadTranscript(q, y);
                }
              }}
              style={{ fontSize: 10, padding: "3px 6px", border: "1px solid rgba(0,0,0,.1)", borderRadius: 4, background: "#fff", color: "#555", cursor: "pointer" }}
            >
              <option value="latest">Latest</option>
              {transcriptList.slice(0, 20).map((entry, i) => {
                // Entry shape: [year, quarter, date] OR {year, quarter, date}
                const year = Array.isArray(entry) ? entry[0] : entry.year;
                const quarter = Array.isArray(entry) ? entry[1] : entry.quarter;
                const date = Array.isArray(entry) ? entry[2] : entry.date;
                return <option key={i} value={`${quarter}-${year}`}>Q{quarter} {year} ({fmtDate(date)})</option>;
              })}
            </select>
          )}
        </div>

        {!apiKey && (
          <div style={{ padding: "20px 12px", background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 8, textAlign: "center", color: "#888", fontSize: 11 }}>
            Add FMP API key to load transcripts
          </div>
        )}
        {apiKey && transcriptLoading && (
          <div style={{ padding: "20px 12px", background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 8, textAlign: "center", color: "#b8860b", fontSize: 11 }}>
            ⌛ Loading transcript…
          </div>
        )}
        {apiKey && !transcriptLoading && !transcript && (
          <div style={{ padding: "20px 12px", background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 8, textAlign: "center", color: "#999", fontSize: 11 }}>
            No transcript available for {co.t}
          </div>
        )}
        {transcript && (
          <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 8, overflow: "hidden" }}>
            {/* Header */}
            <div style={{ padding: "8px 12px", borderBottom: "1px solid rgba(0,0,0,.06)", background: "rgba(0,0,0,.018)" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#222" }}>Q{transcript.quarter} {transcript.year}</span>
                <span style={{ fontSize: 11, color: "#888" }}>{fmtDate(transcript.date)}</span>
                <span style={{ fontSize: 10, color: "#bbb", marginLeft: "auto" }}>
                  {transcript.content ? (transcript.content.length / 1000).toFixed(1) + "k chars" : ""}
                </span>
              </div>
            </div>

            {/* Body */}
            <div style={{ padding: "10px 12px", fontSize: 12, color: "#333", lineHeight: 1.55, maxHeight: transcriptExpanded ? "70vh" : 260, overflowY: "auto", whiteSpace: "pre-wrap" }}>
              {transcriptSections?.prepared && (
                <>
                  <div style={{ fontSize: 10, color: "#bbb", fontWeight: 600, letterSpacing: .5, textTransform: "uppercase", marginBottom: 6 }}>Prepared Remarks</div>
                  <div>{transcriptExpanded ? transcriptSections.prepared : transcriptSections.prepared.slice(0, 2200) + (transcriptSections.prepared.length > 2200 ? "…" : "")}</div>
                </>
              )}
              {transcriptExpanded && transcriptSections?.qa && (
                <>
                  <div style={{ fontSize: 10, color: "#bbb", fontWeight: 600, letterSpacing: .5, textTransform: "uppercase", marginTop: 14, marginBottom: 6, borderTop: "1px solid rgba(0,0,0,.06)", paddingTop: 10 }}>Q&A Session</div>
                  <div>{transcriptSections.qa}</div>
                </>
              )}
            </div>

            {/* Expand/collapse footer */}
            <div style={{ padding: "6px 10px", borderTop: "1px solid rgba(0,0,0,.06)", background: "rgba(0,0,0,.012)", textAlign: "center" }}>
              <button onClick={() => setTranscriptExpanded(!transcriptExpanded)} style={{
                background: "none", border: "none", padding: "2px 8px",
                fontSize: 10, color: "#888", cursor: "pointer", fontWeight: 600, letterSpacing: .3,
              }}>
                {transcriptExpanded ? "▲ Collapse" : transcriptSections?.qa ? "▼ Expand full transcript (incl. Q&A)" : "▼ Expand full transcript"}
              </button>
            </div>
          </div>
        )}
        <div style={{ fontSize: 9, color: "#bbb", marginTop: 6, textAlign: "right" }}>
          Transcripts & filings via FMP · Click any filing to open on SEC EDGAR
        </div>
      </div>
    </>
  );
}

/* ════════════════════════ MARKDOWN EXPORT ════════════════════════ */
// Generates a memo-ready markdown dump of everything we know about a company.
// Pulls from authored schema fields + live liveData/focalFund + module-level fundCache.
// Designed for research-analyst workflow: "read the dashboard, copy the company, paste into notes."

function companyToMarkdown(co, { live, focalFund, price, dailyPct, wkLow, wkHigh }) {
  if (!co) return "";
  const vc = VX[co.v];
  const eff = {
    mc: live?.mc ?? co.mc,
    pe: live?.pe ?? co.pe,
    rev: focalFund?.revenueTTM ?? co.r,
    gm: focalFund?.grossMarginTTM ?? co.g,
    beta: focalFund?.beta ?? co.fin?.beta,
    eps: live?.eps ?? co.fin?.eps,
  };
  const liveTag = (isLive) => isLive ? " · live" : " · authored";
  const fmtMCLocal = n => {
    if (n == null) return "—";
    if (Math.abs(n) >= 1e6) return "$" + (n / 1e6).toFixed(1) + "T";
    if (Math.abs(n) >= 1e3) return "$" + (n / 1e3).toFixed(0) + "B";
    return "$" + n + "M";
  };
  const lines = [];

  // ── TITLE + HEADLINE ──
  lines.push(`# ${co.cc || ""} ${co.t} — ${co.nm}`);
  lines.push(`**${vc.n} · ${co.s}** · Price \`$${price?.toFixed(2) || "—"}\` (${dailyPct >= 0 ? "+" : ""}${dailyPct?.toFixed(2) || "0"}%)`);
  lines.push("");

  // ── ONE-LINER DESCRIPTION ──
  if (co.d) {
    lines.push(`> ${co.d}`);
    lines.push("");
  }
  if (co.pr) {
    lines.push(`**Flagship product:** ${co.pr}`);
    lines.push("");
  }

  // ── KEY METRICS TABLE ──
  lines.push(`## Key Metrics`);
  lines.push(``);
  lines.push(`| Metric | Value | Source |`);
  lines.push(`|---|---|---|`);
  lines.push(`| Market Cap | ${fmtMCLocal(eff.mc)} | ${live?.mc != null ? "live" : "authored"} |`);
  lines.push(`| P/E (TTM) | ${eff.pe ? eff.pe.toFixed(1) + "x" : "—"} | ${live?.pe != null ? "live" : "authored"} |`);
  lines.push(`| Revenue TTM | ${fmtMCLocal(eff.rev)} | ${focalFund?.revenueTTM != null ? "live" : "authored"} |`);
  lines.push(`| Gross Margin | ${eff.gm != null ? Math.round(eff.gm) + "%" : "—"} | ${focalFund?.grossMarginTTM != null ? "live" : "authored"} |`);
  if (focalFund?.netMarginTTM != null) lines.push(`| Net Margin | ${focalFund.netMarginTTM.toFixed(1)}% | live |`);
  if (focalFund?.operMarginTTM != null) lines.push(`| Operating Margin | ${focalFund.operMarginTTM.toFixed(1)}% | live |`);
  if (focalFund?.roeTTM != null) lines.push(`| ROE | ${focalFund.roeTTM.toFixed(1)}% | live |`);
  if (focalFund?.evToEBITDA != null) lines.push(`| EV / EBITDA | ${focalFund.evToEBITDA.toFixed(1)}x | live |`);
  if (focalFund?.priceToSales != null) lines.push(`| P / Sales | ${focalFund.priceToSales.toFixed(2)}x | live |`);
  if (focalFund?.debtToEquity != null) lines.push(`| Debt / Equity | ${focalFund.debtToEquity.toFixed(2)} | live |`);
  lines.push(`| Beta | ${eff.beta != null ? eff.beta.toFixed(2) : "—"} | ${focalFund?.beta != null ? "live" : "authored"} |`);
  lines.push(`| EPS (TTM) | ${eff.eps != null ? "$" + eff.eps.toFixed(2) : "—"} | ${live?.eps != null ? "live" : "authored"} |`);
  if (co.fin?.rg?.[4] != null) lines.push(`| Revenue Growth | ${(co.fin.rg[4] > 0 ? "+" : "") + co.fin.rg[4]}% | authored |`);
  if (co.fin?.div) lines.push(`| Dividend | $${co.fin.div.toFixed(2)} | authored |`);
  if (wkLow && wkHigh) lines.push(`| 52W Range | $${wkLow.toFixed(2)} – $${wkHigh.toFixed(2)} | live |`);
  lines.push("");

  // ── SEGMENTS ──
  if (co.rs && co.rs.length) {
    lines.push(`## Revenue Segmentation`);
    lines.push(``);
    co.rs.forEach(([name, pct]) => { lines.push(`- **${name}:** ${pct}%`); });
    lines.push("");
  }

  // ── GEOGRAPHY ──
  if (co.geo && co.geo.length) {
    lines.push(`## Geographic Mix`);
    lines.push(``);
    co.geo.forEach(([name, pct]) => { lines.push(`- **${name}:** ${pct}%`); });
    lines.push("");
  }

  // ── TOP CUSTOMERS ──
  if (co.tc && co.tc.length) {
    lines.push(`## Top Customers`);
    lines.push(``);
    co.tc.forEach(([name, pct]) => { lines.push(`- **${name}:** ${pct}%`); });
    lines.push("");
  }

  // ── PRODUCT PORTFOLIO ──
  if (co.pl && co.pl.length) {
    lines.push(`## Product Portfolio`);
    lines.push(``);
    co.pl.forEach(p => {
      lines.push(`### ${p.name}${p.pos ? ` _(${p.pos})_` : ""}`);
      if (p.desc) lines.push(p.desc);
      lines.push("");
    });
  }

  // ── COMPETITORS ──
  if (co.cp && co.cp.length) {
    lines.push(`## Competitive Landscape`);
    lines.push(``);
    co.cp.forEach(c => { lines.push(`- ${c}`); });
    lines.push("");
  }

  // ── SUPPLY CHAIN ──
  const sup = EDGES.filter(([, t]) => t === co.t).map(([s, l]) => ({ t: s, l }));
  const cust = EDGES.filter(([s]) => s === co.t).map(([, t, l]) => ({ t, l }));
  if (sup.length || cust.length) {
    lines.push(`## Supply Chain`);
    lines.push(``);
    if (sup.length) {
      lines.push(`**Suppliers:** ${sup.map(s => `$${s.t}${s.l ? ` (${s.l})` : ""}`).join(", ")}`);
      lines.push("");
    }
    if (cust.length) {
      lines.push(`**Customers:** ${cust.map(c => `$${c.t}${c.l ? ` (${c.l})` : ""}`).join(", ")}`);
      lines.push("");
    }
  }

  // ── RISKS ──
  if (co.ri && co.ri.length) {
    lines.push(`## Risks`);
    lines.push(``);
    co.ri.forEach(r => { lines.push(`- ${r}`); });
    lines.push("");
  }

  // ── CATALYSTS ──
  if (co.ca && co.ca.length) {
    lines.push(`## Catalysts`);
    lines.push(``);
    co.ca.forEach(c => { lines.push(`- ${c}`); });
    lines.push("");
  }

  // ── OPERATIONS ──
  if (co.ops) {
    lines.push(`## Operations`);
    lines.push(``);
    if (co.ops.hq) lines.push(`- **Headquarters:** ${co.ops.hq}`);
    if (co.ops.fd) lines.push(`- **Founded:** ${co.ops.fd}`);
    if (co.ops.emp) lines.push(`- **Employees:** ${co.ops.emp.toLocaleString()}`);
    if (co.ops.mfg && co.ops.mfg.length) lines.push(`- **Facilities:** ${co.ops.mfg.join(", ")}`);
    if (co.ops.bl) lines.push(`- **${co.ops.bl.label}:** $${co.ops.bl.val}${co.ops.bl.unit}`);
    if (co.ops.ne) lines.push(`- **Next Earnings:** ${co.ops.ne}`);
    lines.push("");
  }

  // ── OWNERSHIP ──
  if (co.own) {
    lines.push(`## Ownership`);
    lines.push(``);
    if (co.own.insider != null) lines.push(`- **Insider:** ${co.own.insider}%`);
    if (co.own.institutional != null) lines.push(`- **Institutional:** ${co.own.institutional}%`);
    lines.push("");
  }

  // ── THEME TAGS ──
  if (co.themes && co.themes.length) {
    lines.push(`## Investment Themes`);
    lines.push(``);
    lines.push(co.themes.map(t => `\`${t}\``).join(" · "));
    lines.push("");
  }

  // ── FOOTER ──
  lines.push(`---`);
  const now = new Date();
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const datestr = `${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
  lines.push(`*Exported ${datestr} · Pricing via FMP live data · Segment/operations data per most recent company filings*`);

  return lines.join("\n");
}

/* ════════════════════════ DETAIL PANEL (ORCHESTRATOR) ════════════════════════ */
/* ──────── Detail tab: OVERVIEW ──────── */
function OverviewTab({ co, vc, price, apiKey, wkLow, wkHigh, live, focalFund, dayLow, dayHigh, sup, cust, fd, onSelect }) {
  return (
    <>
        {/* ── PRICE CHART (full width, prominent) ── */}
        <div style={{ marginBottom: 12 }}>
          <PriceChart co={co} vc={vc} price={price} apiKey={apiKey} wkLow={wkLow} wkHigh={wkHigh} />
        </div>

        {/* ── KEY STATS (live TTM when available) ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0, marginBottom: 10 }}>
          {[
            ["Mkt Cap", fmtMC(live?.mc || co.mc), live?.mc != null],
            ["P/E (TTM)", (live?.pe || co.pe) ? (live?.pe || co.pe).toFixed(1) + "x" : "—", live?.pe != null],
            ["Beta", (focalFund?.beta != null ? focalFund.beta : (co.fin?.beta != null ? co.fin.beta : NaN)).toFixed ? (focalFund?.beta != null ? focalFund.beta : co.fin.beta).toFixed(2) : "—", focalFund?.beta != null],
            ["Revenue TTM", fmtMC(focalFund?.revenueTTM != null ? focalFund.revenueTTM : co.r), focalFund?.revenueTTM != null],
            ["Gross Margin", (focalFund?.grossMarginTTM != null ? focalFund.grossMarginTTM.toFixed(0) + "%" : (co.g != null ? co.g + "%" : "—")), focalFund?.grossMarginTTM != null],
            ["EPS (TTM)", "$" + (live?.eps != null ? live.eps : (co.fin?.eps || 0)).toFixed(2), live?.eps != null],
            ["Growth", (co.fin?.rg?.[4] != null ? ((co.fin.rg[4] > 0 ? "+" : "") + co.fin.rg[4] + "%") : "—"), false],
            ["Dividend", co.fin?.div ? "$" + co.fin.div.toFixed(2) : "—", false],
            ["Shares", ((live?.sharesOut || co.dc?.sh || 0).toFixed(0)) + "M", live?.sharesOut != null],
          ].map(([l, v, isLive], i) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 8px", background: Math.floor(i / 3) % 2 === 0 ? "rgba(0,0,0,.01)" : "transparent", borderBottom: "1px solid rgba(0,0,0,.025)" }}>
              <span style={{ fontSize: 11, color: "#999" }}>{l}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 11, color: "#333", fontWeight: 600 }}>{v}</span>
                {isLive && <span title="Live from FMP" style={{ display: "inline-block", width: 4, height: 4, borderRadius: 2, background: "#1a8a5c" }} />}
              </span>
            </div>
          ))}
        </div>

        {/* ── RANGE BARS ── */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: "#aaa", marginBottom: 2 }}>Day Range</div>
          <RangeBar low={dayLow} high={dayHigh} current={price} color={vc.c} />
          <div style={{ fontSize: 11, color: "#aaa", marginBottom: 2, marginTop: 5 }}>52 Week Range</div>
          <RangeBar low={wkLow} high={wkHigh} current={price} color={vc.c} />
        </div>

        {/* ── DESCRIPTION + PRODUCT ── */}
        <div style={STYLE_SECTION}>
          <p style={{ fontSize: 13, color: "#555", lineHeight: 1.7, margin: "0 0 8px" }}>{co.d}</p>
          <div style={{ background: vc.bg, borderRadius: 6, padding: "4px 8px", fontSize: 11, color: "#555", borderLeft: "3px solid " + vc.c }}>{co.pr}</div>
        </div>

        {/* ── SUPPLY CHAIN + RISKS/CATALYSTS ── */}
        <div style={{ ...STYLE_SECTION, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <div style={STYLE_LABEL}>Supply chain</div>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: "#bbb", marginBottom: 3 }}>SUPPLIERS → ({sup.length})</div>
              {sup.length > 0 ? sup.map(sx => (
                <div key={sx.t + sx.l} onClick={() => onSelect && onSelect(sx.t)} style={{ fontSize: 11, color: "#777", padding: "2px 0", cursor: "pointer", borderRadius: 3 }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,.03)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <Logo ticker={sx.t} size={12} style={{ marginRight: 3 }} /><span style={{ color: VX[(COMPANIES.find(c => c.t === sx.t) || COMPANIES[0]).v].c }}>${sx.t}</span>
                  <span style={{ color: "#bbb", marginLeft: 4 }}>{sx.l}</span>
                </div>
              )) : <div style={{ fontSize: 11, color: "#ccc" }}>{"—"}</div>}
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#bbb", marginBottom: 3 }}>→ CUSTOMERS ({cust.length})</div>
              {cust.length > 0 ? cust.map(cx => (
                <div key={cx.t + cx.l} onClick={() => onSelect && onSelect(cx.t)} style={{ fontSize: 11, color: "#777", padding: "2px 0", cursor: "pointer", borderRadius: 3 }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,.03)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <Logo ticker={cx.t} size={12} style={{ marginRight: 3 }} /><span style={{ color: VX[(COMPANIES.find(c => c.t === cx.t) || COMPANIES[0]).v].c }}>${cx.t}</span>
                  <span style={{ color: "#bbb", marginLeft: 4 }}>{cx.l}</span>
                </div>
              )) : <div style={{ fontSize: 11, color: "#ccc" }}>End buyer</div>}
            </div>
          </div>
          <div>
            <div style={{ background: "rgba(196,64,64,.03)", borderRadius: 6, padding: 7, marginBottom: 6 }}>
              <div style={{ fontSize: 10, color: "#c44040", letterSpacing: 1.5, marginBottom: 4 }}>RISKS</div>
              {co.ri.map((r, i) => <div key={i} style={{ fontSize: 11, color: "#777", marginBottom: 2, paddingLeft: 8, borderLeft: "2px solid rgba(196,64,64,.15)", lineHeight: 1.5 }}>{r}</div>)}
            </div>
            <div style={{ background: "rgba(26,138,92,.03)", borderRadius: 6, padding: 7 }}>
              <div style={{ fontSize: 10, color: "#1a8a5c", letterSpacing: 1.5, marginBottom: 4 }}>CATALYSTS</div>
              {co.ca.map((c, i) => <div key={i} style={{ fontSize: 11, color: "#777", marginBottom: 2, paddingLeft: 8, borderLeft: "2px solid rgba(26,138,92,.15)", lineHeight: 1.5 }}>{c}</div>)}
            </div>
          </div>
        </div>

        {/* ── ANNUAL REVENUE ── */}
        <div style={STYLE_SECTION}>
          <div style={STYLE_LABEL}>Annual Revenue</div>
          <ResponsiveContainer width="100%" height={75}>
            <BarChart data={fd.years.map((y, i) => ({ year: y, rev: fd.revs[i] }))} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
              <XAxis dataKey="year" tick={{ fontSize: 10, fill: "#999" }} axisLine={{ stroke: "#e0e0e0" }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#aaa" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "#fff", border: "1px solid rgba(0,0,0,.08)", borderRadius: 6, fontSize: 11 }} formatter={(v) => [fmtMC(v), "Revenue"]} />
              <Bar dataKey="rev" fill={vc.c} radius={[4, 4, 0, 0]} barSize={28} fillOpacity={0.7}>
                {fd.years.map((y, i) => <Cell key={i} fill={y.includes("E") ? vc.c + "88" : vc.c} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* ── OPERATIONS (schema-tolerant) ── */}
        <div style={STYLE_SECTION}>
          <div style={STYLE_LABEL}>Operations snapshot</div>
          <OpsStrip co={co} color={vc.c} />
        </div>
    </>
  );
}

/* ──────── Detail tab: BUSINESS ──────── */
function BusinessTab({ co, vc, live, sup, cust, onSelect, liveData, liveHist, apiKey }) {
  return (
    <>
          {/* Revenue Segments */}
          <div style={{ marginBottom: 14 }}>
            <div style={STYLE_LABEL}>Revenue segments</div>
            {co.rs && co.rs.length > 0 ? (
              <StackedBar data={co.rs} color={vc.c} height={22} />
            ) : (
              <DataPending label="Segment breakdown pending — will show revenue mix by product line / business unit" />
            )}
          </div>

          {/* Geographic Mix */}
          <div style={{ marginBottom: 14 }}>
            <div style={STYLE_LABEL}>Geographic mix</div>
            {co.geo && co.geo.length > 0 ? (
              <StackedBar data={co.geo} color={vc.c} height={22} />
            ) : (
              <DataPending label="Geographic revenue mix pending — critical for tariff and China exposure" />
            )}
          </div>

          {/* Top Customers */}
          <div style={{ marginBottom: 14 }}>
            <div style={STYLE_LABEL}>Customer concentration</div>
            {co.tc && co.tc.length > 0 ? (
              <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 8, padding: 10 }}>
                <StackedBar data={co.tc.map(([n, p]) => [n, p])} color={vc.c} height={20} />
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(0,0,0,.04)" }}>
                  {co.tc.map(([n, p]) => (
                    <div key={n} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontSize: 11 }}>
                      <span style={{ color: "#555", fontWeight: 600 }}>{n}</span>
                      <span style={{ color: "#333", fontWeight: 700 }}>{p}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <DataPending label="Named customer concentration pending — will include top 3–5 named customers with revenue %" />
            )}
          </div>

          {/* Product Lines */}
          <div style={{ marginBottom: 14 }}>
            <div style={STYLE_LABEL}>Product portfolio</div>
            {co.pl && co.pl.length > 0 ? (
              <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 8, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "rgba(0,0,0,.018)", borderBottom: "1px solid rgba(0,0,0,.06)" }}>
                      <th style={{ textAlign: "left", padding: "5px 8px", fontSize: 10, color: "#aaa", fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>Product</th>
                      <th style={{ textAlign: "left", padding: "5px 8px", fontSize: 10, color: "#aaa", fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>Description</th>
                      <th style={{ textAlign: "right", padding: "5px 8px", fontSize: 10, color: "#aaa", fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>Position</th>
                    </tr>
                  </thead>
                  <tbody>
                    {co.pl.map((p, i) => (
                      <tr key={i} style={{ borderBottom: i < co.pl.length - 1 ? "1px solid rgba(0,0,0,.04)" : "none" }}>
                        <td style={{ padding: "5px 8px", fontSize: 11, color: "#333", fontWeight: 600 }}>{p.name}</td>
                        <td style={{ padding: "5px 8px", fontSize: 11, color: "#666" }}>{p.desc}</td>
                        <td style={{ padding: "5px 8px", fontSize: 11, color: vc.c, textAlign: "right", fontWeight: 600 }}>{p.pos || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ background: vc.bg, borderRadius: 6, padding: "6px 10px", fontSize: 11, color: "#555", borderLeft: "3px solid " + vc.c }}>{co.pr}</div>
            )}
          </div>

          {/* Peer comparison */}
          <div style={{ marginBottom: 14 }}>
            <div style={STYLE_LABEL}>Peer comparison</div>
            <PeerGrid co={co} color={vc.c} onSelect={onSelect} />
            <div style={{ fontSize: 10, color: "#aaa", marginTop: 4, fontStyle: "italic" }}>
              Peers selected by closest market cap within same sub-layer and vertical. Dot shows rank in peer set.
            </div>
          </div>

          {/* Supply chain detail */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
            <div>
              <div style={STYLE_LABEL}>Suppliers ({sup.length})</div>
              <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 6, padding: 8, minHeight: 60 }}>
                {sup.length > 0 ? sup.map(sx => {
                  const sCo = COMPANIES.find(c => c.t === sx.t);
                  return (
                    <div key={sx.t + sx.l} onClick={() => onSelect && onSelect(sx.t)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 4px", cursor: "pointer", borderRadius: 3, fontSize: 11 }}
                      onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,.03)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <Logo ticker={sx.t} size={14} />
                      <span style={{ color: sCo ? VX[sCo.v].c : "#777", fontWeight: 600 }}>{sx.t}</span>
                      <span style={{ color: "#bbb", marginLeft: "auto", fontSize: 10 }}>{sx.l}</span>
                    </div>
                  );
                }) : <div style={{ fontSize: 11, color: "#ccc", padding: 4 }}>End of chain</div>}
              </div>
            </div>
            <div>
              <div style={STYLE_LABEL}>Customers ({cust.length})</div>
              <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 6, padding: 8, minHeight: 60 }}>
                {cust.length > 0 ? cust.map(cx => {
                  const cCo = COMPANIES.find(c => c.t === cx.t);
                  return (
                    <div key={cx.t + cx.l} onClick={() => onSelect && onSelect(cx.t)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 4px", cursor: "pointer", borderRadius: 3, fontSize: 11 }}
                      onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,.03)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <Logo ticker={cx.t} size={14} />
                      <span style={{ color: cCo ? VX[cCo.v].c : "#777", fontWeight: 600 }}>{cx.t}</span>
                      <span style={{ color: "#bbb", marginLeft: "auto", fontSize: 10 }}>{cx.l}</span>
                    </div>
                  );
                }) : <div style={{ fontSize: 11, color: "#ccc", padding: 4 }}>End buyer</div>}
              </div>
            </div>
          </div>

          {/* Peer comparison table */}
          <div style={{ marginBottom: 4 }}>
            <div style={STYLE_LABEL}>Peer comparison · live fundamentals</div>
            {co.cp && co.cp.length > 0 ? (
              <PeerTable co={co} liveData={liveData} liveHist={liveHist} apiKey={apiKey} onSelect={onSelect} accent={vc.c} />
            ) : (
              <DataPending label="Named direct competitors pending — will include cross-references to in-universe tickers where applicable" />
            )}
          </div>
    </>
  );
}

/* ──────── Detail tab: FINANCIALS ──────── */
function DetailFinancialsTab({ co, vc, fd, scenarioAdj }) {
  return (
    <>
          {/* Quarterly EPS: beats vs estimates */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={STYLE_LABEL}>Quarterly EPS · actual vs estimate</div>
              <div style={{ display: "flex", gap: 10, fontSize: 10, color: "#888" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                  <span style={{ width: 8, height: 8, background: "#e8e8e8", borderRadius: 1 }} />Estimate
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                  <span style={{ width: 8, height: 8, background: "#1a8a5c", borderRadius: 1 }} />Beat
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                  <span style={{ width: 8, height: 8, background: "#c44040", borderRadius: 1 }} />Miss
                </span>
              </div>
            </div>
            <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 8, padding: "8px 10px" }}>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={fd.qEPS} margin={{ top: 6, right: 8, bottom: 5, left: -10 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#999" }} axisLine={{ stroke: "#e0e0e0" }} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#aaa" }} axisLine={false} tickLine={false} tickFormatter={v => "$" + v.toFixed(2)} width={40} />
                  <Tooltip contentStyle={{ background: "#fff", border: "1px solid rgba(0,0,0,.08)", borderRadius: 6, fontSize: 11 }}
                    formatter={(v, name) => ["$" + v.toFixed(2), name]} />
                  <Bar dataKey="estimate" fill="#e8e8e8" radius={[2, 2, 0, 0]} barSize={10} name="Est" />
                  <Bar dataKey="actual" radius={[2, 2, 0, 0]} barSize={10} name="Actual">
                    {fd.qEPS.map((e, i) => <Cell key={i} fill={e.beat ? "#1a8a5c" : "#c44040"} />)}
                  </Bar>
                  <ReferenceLine y={0} stroke="#ddd" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Key Ratios Strip */}
          <div style={STYLE_SECTION}>
            <div style={STYLE_LABEL}>Key ratios · 5-year trend</div>
            <KeyRatios ratios={fd.ratiosData} co={co} color={vc.c} />
          </div>

          {/* Financial Statements (IS / BS / CF) */}
          <div style={STYLE_SECTION}>
            <div style={STYLE_LABEL}>Financial statements</div>
            <FinancialsTab co={co} color={vc.c} scenarioAdj={scenarioAdj} />
          </div>

          {/* Investment & intensity trends */}
          <div style={STYLE_SECTION}>
            <div style={STYLE_LABEL}>Investment intensity</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 8, padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: "#999", textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>R&D ÷ Revenue</span>
                  <TrendSpark values={fd.ratiosData.map(r => r.rdIntensity)} color={vc.c} width={120} height={30} />
                </div>
                <div style={{ fontSize: 10, color: "#aaa" }}>
                  {co.v === "compute" ? "High R&D intensity is expected — tech leadership requires it" :
                   co.v === "photonics" ? "Photonics R&D reflects process and device innovation" :
                   co.v === "hyperscaler" ? "Hyperscaler R&D funds both software and silicon" : "Steady R&D reinvestment sustains margin"}
                </div>
              </div>
              <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 8, padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: "#999", textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>Capex ÷ Revenue</span>
                  <TrendSpark values={fd.ratiosData.map(r => r.capexIntensity)} color={vc.c} width={120} height={30} />
                </div>
                <div style={{ fontSize: 10, color: "#aaa" }}>
                  {co.v === "hyperscaler" ? "AI buildout cycle drives sustained elevated capex" :
                   co.v === "dcInfra" ? "Capital-intensive DC infrastructure by design" :
                   co.v === "memory" || co.s === "Foundry" ? "Fab capex cycles drive margin volatility" : "Typical asset-light model"}
                </div>
              </div>
            </div>
          </div>

          {/* Cash runway for unprofitable */}
          {fd.ratiosData[4]?.runwayQtrs != null && (
            <div style={STYLE_SECTION}>
              <div style={STYLE_LABEL}>Cash runway</div>
              <div style={{ background: fd.ratiosData[4].runwayQtrs < 4 ? "rgba(196,64,64,.04)" : fd.ratiosData[4].runwayQtrs < 8 ? "rgba(184,134,11,.04)" : "rgba(26,138,92,.04)",
                border: "1px solid " + (fd.ratiosData[4].runwayQtrs < 4 ? "rgba(196,64,64,.15)" : fd.ratiosData[4].runwayQtrs < 8 ? "rgba(184,134,11,.15)" : "rgba(26,138,92,.15)"),
                borderRadius: 6, padding: "8px 12px", display: "flex", alignItems: "center", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: fd.ratiosData[4].runwayQtrs < 4 ? "#c44040" : fd.ratiosData[4].runwayQtrs < 8 ? "#b8860b" : "#1a8a5c" }}>
                    {fd.ratiosData[4].runwayQtrs}<span style={{ fontSize: 11, marginLeft: 3 }}>quarters</span>
                  </div>
                  <div style={{ fontSize: 10, color: "#999" }}>Implied runway at current burn rate</div>
                </div>
                <div style={{ fontSize: 11, color: "#666", flex: 1 }}>
                  {fd.ratiosData[4].runwayQtrs < 4 ? "Short runway — capital raise or profitability inflection needed near-term." :
                   fd.ratiosData[4].runwayQtrs < 8 ? "Manageable runway but dilution risk over medium-term if burn continues." :
                   "Comfortable runway supports operational execution through the cycle."}
                </div>
              </div>
            </div>
          )}
    </>
  );
}

function Detail({ co, onClose, onSelect, liveData = {}, liveHist = {}, apiKey, onJumpToTrade }) {
  const [scenarioAdj, setScenarioAdj] = useState(null);
  const [detailTab, setDetailTab] = useState("overview");
  const [focalFund, setFocalFund] = useState(null); // live TTM fundamentals for focal co
  const [copyStatus, setCopyStatus] = useState(null); // null | "copied" | "error"
  if (!co) return null;
  const vc = VX[co.v];
  const live = liveData[co.t];
  const price = live?.price || SP[co.t] || co.mc / (co.dc.sh || 1);
  const dailyChg = live?.change || price * (co.fin.rg[4] || 10) / 100 / 252;
  const dailyPct = live?.changePct || (co.fin.rg[4] || 10) / 252;
  const dayLow = live?.dayLow || +(price * 0.985).toFixed(2);
  const dayHigh = live?.dayHigh || +(price * 1.012).toFixed(2);
  const wkLow = live?.yearLow || +(price * 0.62).toFixed(2);
  const wkHigh = live?.yearHigh || +(price * 1.28).toFixed(2);

  // Lazy fetch live TTM fundamentals for focal company on mount / co change.
  // Results get used in both the Overview key-stats grid and the PeerTable.
  useEffect(() => {
    setFocalFund(null);
    if (!apiKey) return;
    const shares = liveData[co.t]?.sharesOut;
    fetchFund(co.t, apiKey, shares).then(data => setFocalFund(data));
  }, [co.t, apiKey]);

  const sup = EDGES.filter(([, t]) => t === co.t).map(([s, l]) => ({ t: s, l }));
  const cust = EDGES.filter(([s]) => s === co.t).map(([, t, l]) => ({ t, l }));

  const fd = useMemo(() => genFinancials(co), [co.t]);
  return (
    <div style={{ background: "#ffffff", borderRadius: 14, border: "1px solid rgba(0,0,0,.06)", overflow: "hidden", animation: "slideUp 0.3s ease", boxShadow: "0 4px 16px rgba(0,0,0,.06), 0 1px 3px rgba(0,0,0,.04)" }}>
      {/* ── HEADER ── */}
      <div style={{ padding: "12px 16px 10px", background: "linear-gradient(to bottom, rgba(0,0,0,.01), transparent)", borderBottom: "1px solid rgba(0,0,0,.05)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 11, color: "#999" }}>{vc.n} &middot; {co.s}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 3 }}>
              <Logo ticker={co.t} size={22} style={{ marginRight: 6 }} /><span style={{ fontSize: 22, color: "#111" }}>{co.cc} {co.t}</span>
              <span style={{ fontSize: 13, color: "#888" }}>{co.nm}</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
              <span style={{ fontSize: 20, fontWeight: 700, color: "#111" }}>${price.toFixed(2)}</span>
              <span style={{ fontSize: 12, color: dailyChg >= 0 ? "#1a8a5c" : "#c44040" }}>
                {dailyChg >= 0 ? "+" : ""}{dailyChg.toFixed(2)} ({dailyPct >= 0 ? "+" : ""}{dailyPct.toFixed(2)}%)
              </span>
            </div>
            <div style={{ fontSize: 10, color: "#bbb", marginTop: 2 }}>
              Bid ${(price * 0.999).toFixed(2)} x 500 &nbsp;&middot;&nbsp; Ask ${(price * 1.001).toFixed(2)} x 500
            </div>
          </div>

          {/* Export actions */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <button
              onClick={() => onJumpToTrade && onJumpToTrade(co.t)}
              title="Open this symbol on the Trade tab"
              style={{
                background: "#fff",
                border: "1px solid rgba(0,0,0,.08)",
                borderRadius: 6,
                padding: "4px 10px",
                fontSize: 11,
                fontWeight: 600,
                color: "#333",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <span>↗</span>
              <span>Open in Trade</span>
            </button>
            <button
              onClick={() => {
                const md = companyToMarkdown(co, { live, focalFund, price, dailyPct, wkLow, wkHigh });
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  navigator.clipboard.writeText(md).then(
                    () => { setCopyStatus("copied"); setTimeout(() => setCopyStatus(null), 2000); },
                    () => { setCopyStatus("error"); setTimeout(() => setCopyStatus(null), 2000); }
                  );
                } else {
                  // Fallback: temporary textarea
                  try {
                    const ta = document.createElement("textarea");
                    ta.value = md;
                    ta.style.position = "fixed";
                    ta.style.top = "-9999px";
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand("copy");
                    document.body.removeChild(ta);
                    setCopyStatus("copied");
                    setTimeout(() => setCopyStatus(null), 2000);
                  } catch(e) {
                    setCopyStatus("error");
                    setTimeout(() => setCopyStatus(null), 2000);
                  }
                }
              }}
              title="Copy this company as memo-ready markdown"
              style={{
                background: copyStatus === "copied" ? "rgba(26,138,92,.12)" : copyStatus === "error" ? "rgba(196,64,64,.12)" : "#fff",
                border: `1px solid ${copyStatus === "copied" ? "rgba(26,138,92,.35)" : copyStatus === "error" ? "rgba(196,64,64,.35)" : "rgba(0,0,0,.08)"}`,
                borderRadius: 6, padding: "4px 10px",
                fontSize: 11, fontWeight: 600,
                color: copyStatus === "copied" ? "#1a8a5c" : copyStatus === "error" ? "#c44040" : "#555",
                cursor: "pointer",
                display: "inline-flex", alignItems: "center", gap: 5,
                transition: "all .2s ease",
              }}
            >
              {copyStatus === "copied" ? (
                <><span>✓</span><span>Copied markdown</span></>
              ) : copyStatus === "error" ? (
                <><span>✕</span><span>Copy failed</span></>
              ) : (
                <><span>📋</span><span>Copy as Markdown</span></>
              )}
            </button>
          </div>

        </div>
      </div>

      <div style={{ padding: "10px 14px 14px", maxHeight: "70vh", overflowY: "auto" }}>
        {/* ── TAB BAR ── */}
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid rgba(0,0,0,.06)", marginBottom: 10, marginTop: -2 }}>
          {[["overview", "Overview"], ["business", "Business"], ["financials", "Financials"], ["valuation", "Valuation"], ["filings", "📄 Filings"]].map(([id, lb]) => (
            <button key={id} onClick={() => setDetailTab(id)} style={{
              background: "none", border: "none",
              borderBottom: detailTab === id ? "2px solid " + vc.c : "2px solid transparent",
              padding: "6px 14px", color: detailTab === id ? vc.c : "#888",
              fontSize: 11, fontWeight: detailTab === id ? 700 : 500, cursor: "pointer", letterSpacing: 0.3,
            }}>{lb}</button>
          ))}
        </div>

        {detailTab === "overview" && <OverviewTab co={co} vc={vc} price={price} apiKey={apiKey} wkLow={wkLow} wkHigh={wkHigh} live={live} focalFund={focalFund} dayLow={dayLow} dayHigh={dayHigh} sup={sup} cust={cust} fd={fd} onSelect={onSelect} />}

        {/* ╔══════════════════════ BUSINESS TAB ══════════════════════╗ */}
        {detailTab === "business" && <BusinessTab co={co} vc={vc} live={live} sup={sup} cust={cust} onSelect={onSelect} liveData={liveData} liveHist={liveHist} apiKey={apiKey} />}

        {/* ╔══════════════════════ FINANCIALS TAB ══════════════════════╗ */}
        {detailTab === "financials" && <DetailFinancialsTab co={co} vc={vc} fd={fd} scenarioAdj={scenarioAdj} />}

        {/* ╔══════════════════════ VALUATION TAB ══════════════════════╗ */}
        {detailTab === "valuation" && <>
          <ValuationTab co={co} color={vc.c} scenarioAdj={scenarioAdj} onScenarioChange={setScenarioAdj} />
        </>}

        {detailTab === "filings" && <FilingsTab co={co} apiKey={apiKey} />}

        {/* ── BACK TO GRAPH (always visible) ── */}
        <div style={{ borderTop: "1px solid rgba(0,0,0,.06)", marginTop: 16, paddingTop: 12, textAlign: "center" }}>
          <button onClick={onClose} style={{
            background: "#fff", border: "1px solid rgba(0,0,0,.08)", borderRadius: 8,
            padding: "6px 20px", boxShadow: "0 1px 3px rgba(0,0,0,.04)", color: "#888", fontSize: 10, cursor: "pointer", fontWeight: 600,
          }}>Back to graph</button>
        </div>
      </div>
    </div>
  );
}

/* ═════════════════ VALUE STREAM SANKEY ═════════════════ */
// Extracted from MarketSummary Row 6 — the largest sub-block in the dashboard.
// Owns its own sankeyExp (focused flow) + sankeyHover state.
function ValueStreamSankey({ theme, onSelect }) {
  const [sankeyExp, setSankeyExp] = useState(null);
  const [sankeyHover, setSankeyHover] = useState(null);
  return (
    <>
      {/* ═══ ROW 6: VALUE STREAM ═══ */}
      <div style={{ marginBottom: 14 }}>
        <div style={STYLE_LABEL_DIM}>Value stream — hover to preview, click to explore</div>
        <div style={{ ...STYLE_CARD, padding: "6px 2px", overflowX: "auto" }}>
          {(() => {
            const focused = sankeyExp;
            const setFocused = setSankeyExp;
            const hoverTicker = sankeyHover, setHoverTicker = setSankeyHover;

            const stages = theme?.sankey || AI_SANKEY_STAGES;

            const groupMap = {}, edgeCountCache = {};
            stages.forEach(st => st.groups.forEach(g => {
              g.rev = g.tickers.reduce((a, t) => a + (COMPANIES.find(c => c.t === t)?.r || 0), 0);
              g.tickers.forEach(t => { if (!groupMap[t]) groupMap[t] = g.id; });
            }));
            // Initial revenue-sort; will be re-sorted by destination barycenter after positions settle
            EDGES.forEach(([s]) => { edgeCountCache[s] = (edgeCountCache[s] || 0) + 1; });

            // Build company flows, aggregating duplicate edges and filtering backward flows
            const stageOf = {};
            stages.forEach((st, si) => st.groups.forEach(g => { stageOf[g.id] = si; }));
            const cfMap = {};
            EDGES.forEach(([s, t]) => {
              const sg = groupMap[s], tg = groupMap[t];
              if (sg && tg && sg !== tg && stageOf[tg] > stageOf[sg]) { // forward only
                const rev = COMPANIES.find(c => c.t === s)?.r || 100;
                const srcGrp = stages.flatMap(st => st.groups).find(g => g.tickers.includes(s));
                const k = s + ">" + sg + ">" + tg;
                const v = Math.max(80, Math.round(rev / (edgeCountCache[s] || 1)));
                if (!cfMap[k]) cfMap[k] = { from: sg, to: tg, ticker: s, value: 0, color: srcGrp?.bc || "#888" };
                cfMap[k].value += v;
              }
            });
            const companyFlows = Object.values(cfMap);

            const pairMap = {};
            companyFlows.forEach(f => {
              const key = f.from + ">" + f.to;
              if (!pairMap[key]) pairMap[key] = { from: f.from, to: f.to, cos: {}, total: 0 };
              if (!pairMap[key].cos[f.ticker]) pairMap[key].cos[f.ticker] = { value: 0, color: f.color };
              pairMap[key].cos[f.ticker].value += f.value;
              pairMap[key].total += f.value;
            });
            const groupFlows = Object.values(pairMap).filter(f => f.total > 0);

            // Expanded layout - more vertical space
            const W = 840, H = 680, nodeW = 20;
            const colX = [10, 138, 266, 394, 522, 650, 778];
            const allGroups = stages.flatMap(s => s.groups);
            const maxRev = Math.max(...allGroups.map(g => g.rev), 1);
            const scaleH = (rev) => Math.max(12, Math.pow(rev / maxRev, 0.28) * 130);

            // Initial positions - center vertically
            const TOP_PAD = 34; // space for stage headers
            const BOT_PAD = 14; // bottom padding
            // Express lane constants - bisects the diagram horizontally
            const LANE_CENTER = H / 2;
            const LANE_HEIGHT = 140; // wide lane, no visible boundary
            const LANE_TOP = LANE_CENTER - LANE_HEIGHT / 2;
            const LANE_BOTTOM = LANE_CENTER + LANE_HEIGHT / 2;
            const ABOVE_ZONE_BOTTOM = LANE_TOP - 4; // small gap above lane
            const BELOW_ZONE_TOP = LANE_BOTTOM + 4;  // small gap below lane
            // Initial positions - side-aware (above/below zones with lane in middle)
            stages.forEach((st, si) => {
              st.groups.forEach(g => { g.h = scaleH(g.rev); g.cx = colX[si]; g.srcOff = 0; g.dstOff = 0; });
              const above = st.groups.filter(g => g.side === "above");
              const below = st.groups.filter(g => g.side === "below");
              const aboveTotalH = above.reduce((a, g) => a + g.h + 10, -10);
              const aboveZoneH = ABOVE_ZONE_BOTTOM - TOP_PAD;
              let y = TOP_PAD + Math.max(0, (aboveZoneH - aboveTotalH) / 2);
              above.forEach(g => { g.y = y; y += g.h + 10; });
              const belowTotalH = below.reduce((a, g) => a + g.h + 10, -10);
              const belowZoneH = (H - BOT_PAD) - BELOW_ZONE_TOP;
              y = BELOW_ZONE_TOP + Math.max(0, (belowZoneH - belowTotalH) / 2);
              below.forEach(g => { g.y = y; y += g.h + 10; });
            });

            // Exhaustive crossing minimization - try all column orderings
            const applyOrder = (stage) => {
              const above = stage.groups.filter(g => g.side === "above");
              const below = stage.groups.filter(g => g.side === "below");
              const aboveTotalH = above.reduce((a, g) => a + g.h + 10, -10);
              const aboveZoneH = ABOVE_ZONE_BOTTOM - TOP_PAD;
              let y = TOP_PAD + Math.max(0, (aboveZoneH - aboveTotalH) / 2);
              above.forEach(g => { g.y = y; y += g.h + 10; });
              const belowTotalH = below.reduce((a, g) => a + g.h + 10, -10);
              const belowZoneH = (H - BOT_PAD) - BELOW_ZONE_TOP;
              y = BELOW_ZONE_TOP + Math.max(0, (belowZoneH - belowTotalH) / 2);
              below.forEach(g => { g.y = y; y += g.h + 10; });
            };

            // Count weighted crossings in the entire diagram
            const countCrossings = () => {
              let crossings = 0;
              for (let i = 0; i < groupFlows.length; i++) {
                for (let j = i + 1; j < groupFlows.length; j++) {
                  const a = groupFlows[i], b = groupFlows[j];
                  const sA = allGroups.find(g => g.id === a.from);
                  const sB = allGroups.find(g => g.id === b.from);
                  const dA = allGroups.find(g => g.id === a.to);
                  const dB = allGroups.find(g => g.id === b.to);
                  if (!sA || !sB || !dA || !dB) continue;
                  // Two flows cross if their sources are in same column
                  // and destinations in same column, with opposite orderings
                  if (sA.cx !== sB.cx || dA.cx !== dB.cx) continue;
                  if (sA.cx === dA.cx) continue; // no crossing possible if same column
                  const syA = sA.y, syB = sB.y, dyA = dA.y, dyB = dB.y;
                  if ((syA < syB && dyA > dyB) || (syA > syB && dyA < dyB)) {
                    crossings += Math.sqrt(a.total * b.total);
                  }
                }
              }
              return crossings;
            };

            // Permutation helper
            const permute = (arr) => {
              if (arr.length <= 1) return [arr.slice()];
              const result = [];
              for (let i = 0; i < arr.length; i++) {
                const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
                for (const p of permute(rest)) result.push([arr[i], ...p]);
              }
              return result;
            };

            // Exhaustive search per (column, side) - permute only within each side
            for (let pass = 0; pass < 3; pass++) {
              let improved = false;
              for (let si = 0; si < stages.length; si++) {
                const st = stages[si];
                ["above", "below"].forEach(side => {
                  const sideGroups = st.groups.filter(g => g.side === side);
                  const otherGroups = st.groups.filter(g => g.side !== side);
                  if (sideGroups.length <= 1) return;
                  let bestSide = sideGroups.slice();
                  let bestCrossings = countCrossings();
                  for (const perm of permute(sideGroups)) {
                    // Reassemble st.groups keeping other-side order intact
                    st.groups = [...otherGroups, ...perm];
                    applyOrder(st);
                    const c2 = countCrossings();
                    if (c2 < bestCrossings) { bestCrossings = c2; bestSide = perm.slice(); improved = true; }
                  }
                  st.groups = [...otherGroups, ...bestSide];
                  applyOrder(st);
                });
              }
              if (!improved) break;
            }

            // Express highway is a fixed horizontal band at LANE_TOP..LANE_BOTTOM
            // Individual flow "lanes" are allocated within this band

            // Re-sort tickers within each group by destination barycenter for cleaner fan-out
            // Each ticker's vertical position in its group matches its outflow's center of gravity
            allGroups.forEach(g => {
              const bcMap = {};
              g.tickers.forEach(t => {
                const outs = companyFlows.filter(f => f.ticker === t);
                let wy = 0, wt = 0;
                outs.forEach(f => {
                  const dg = allGroups.find(gg => gg.id === f.to);
                  if (dg) { wy += (dg.y + dg.h/2) * f.value; wt += f.value; }
                });
                bcMap[t] = wt > 0 ? wy/wt : (COMPANIES.find(c => c.t === t)?.r || 0) * -1; // revenue desc as fallback
              });
              g.tickers = g.tickers.slice().sort((a, b) => bcMap[a] - bcMap[b]);
            });

            // COMPANY-PRIORITY LAYOUT: each company has a fixed slice in its source node.
            // All outflows from that company exit from that slice. Lanes stay together.

            // Step 1: Compute per-company outflows (value × count) and per-company inflows
            const coOutflow = {}; // ticker → total outgoing value
            const coInflow = {};  // ticker → total incoming value (for destination grouping)
            companyFlows.forEach(f => {
              coOutflow[f.ticker] = (coOutflow[f.ticker] || 0) + f.value;
            });

            // Step 2: Allocate each company a vertical slice within its group's node
            // based on outflow share. Slices are ordered by ticker index (stable).
            // Store company slice positions (source side = outflow, dest side = inflow)
            const coSrcY = {}; // ticker → y position at source node (top of slice)
            const coSrcH = {}; // ticker → height of source slice
            allGroups.forEach(g => {
              const gOutflow = g.tickers.reduce((a, t) => a + (coOutflow[t] || 0), 0);
              if (gOutflow === 0) return;
              // Order companies by ticker position (stable, consistent)
              const ordered = g.tickers.filter(t => coOutflow[t] > 0);
              let y = g.y;
              ordered.forEach(t => {
                const h = (coOutflow[t] / gOutflow) * g.h;
                coSrcY[t] = y;
                coSrcH[t] = h;
                y += h;
              });
            });

            // Step 3: For incoming flows at destination groups, accumulate per (source-group, ticker)
            // Position: each group inflow is positioned by source-group Y, and within a source-group
            // by ticker order.
            // Sort inflow allocation: first by source group y, then by ticker index within source
            const dstSlices = {}; // groupId → list of {ticker, fromGroup, height, y}
            allGroups.forEach(g => { dstSlices[g.id] = []; });

            // Total incoming per destination group
            groupFlows.forEach(gf => {
              const srcGrp = allGroups.find(g => g.id === gf.from);
              if (!srcGrp) return;
              const ordered = srcGrp.tickers.filter(t => gf.cos[t]);
              ordered.forEach(t => {
                dstSlices[gf.to].push({
                  ticker: t, fromGroup: gf.from,
                  srcY: srcGrp.y, srcIdx: srcGrp.tickers.indexOf(t),
                  value: gf.cos[t].value,
                });
              });
            });

            // Sort destination slices by source group Y, then ticker index (stable)
            Object.keys(dstSlices).forEach(gid => {
              dstSlices[gid].sort((a, b) => a.srcY - b.srcY || a.srcIdx - b.srcIdx);
            });

            // Allocate destination Y positions
            const flowDstY = {}; // "ticker>fromGroup>toGroup" → {y, h} at destination
            allGroups.forEach(g => {
              const slices = dstSlices[g.id];
              const totalInflow = slices.reduce((a, s) => a + s.value, 0);
              if (totalInflow === 0) return;
              let y = g.y;
              slices.forEach(s => {
                const h = (s.value / totalInflow) * g.h;
                flowDstY[s.ticker + ">" + s.fromGroup + ">" + g.id] = { y, h };
                y += h;
              });
            });

            // Step 4: For source slices, sub-divide each company's slice by destination order
            // Each company's outgoing flows are stacked within its slice, ordered by destination Y
            const flowSrcY = {}; // "ticker>fromGroup>toGroup" → {y, h} at source
            allGroups.forEach(g => {
              g.tickers.forEach(t => {
                if (!coOutflow[t]) return;
                // Get all outflows from this company
                const outs = companyFlows.filter(f => f.ticker === t && f.from === g.id);
                // Sort by destination Y
                outs.sort((a, b) => {
                  const dA = allGroups.find(gg => gg.id === a.to);
                  const dB = allGroups.find(gg => gg.id === b.to);
                  return (dA?.y || 0) - (dB?.y || 0);
                });
                let y = coSrcY[t];
                outs.forEach(f => {
                  const h = (f.value / coOutflow[t]) * coSrcH[t];
                  flowSrcY[t + ">" + f.from + ">" + f.to] = { y, h };
                  y += h;
                });
              });
            });

            // Step 5: Build ribbons - lane is only for CROSS-SIDE flows (those that actually need to traverse the middle)
            const allRibbons = [];

            // Classify: lane flows cross the middle (src.side !== dst.side). Same-side flows, even if long,
            // use natural curves and stay in their own zone (no unnecessary detour through middle).
            const laneFlows = [];
            const normalFlows = [];
            companyFlows.forEach(f => {
              const sg = allGroups.find(g => g.id === f.from);
              const dg = allGroups.find(g => g.id === f.to);
              if (!sg || !dg) return;
              const gap = stageOf[f.to] - stageOf[f.from];
              if (sg.side !== dg.side && gap >= 2) laneFlows.push(f);
              else normalFlows.push(f);
            });

            // Sort lane flows for clean stacking: by direction (up/down), then source x, then source y
            laneFlows.sort((a, b) => {
              const sa = allGroups.find(g => g.id === a.from);
              const sb = allGroups.find(g => g.id === b.from);
              const da = allGroups.find(g => g.id === a.to);
              const db = allGroups.find(g => g.id === b.to);
              // Flows going down (above→below) stack first; then up (below→above)
              const dirA = sa.side === "above" ? 0 : 1;
              const dirB = sb.side === "above" ? 0 : 1;
              if (dirA !== dirB) return dirA - dirB;
              return (sa.cx - sb.cx) || (sa.y - sb.y) || (da.cx - db.cx) || (da.y - db.y);
            });

            // Allocate lane y-positions within the wide invisible band
            const LANE_INNER_PAD = 2;
            const LANE_USABLE_H = LANE_HEIGHT - 2 * LANE_INNER_PAD;
            const totalLaneH = laneFlows.reduce((sum, f) => {
              const srcPos = flowSrcY[f.ticker + ">" + f.from + ">" + f.to];
              return sum + (srcPos?.h || 1);
            }, 0);
            const laneScale = totalLaneH > LANE_USABLE_H ? LANE_USABLE_H / totalLaneH : 1;
            let laneOffset = LANE_TOP + LANE_INNER_PAD + Math.max(0, (LANE_USABLE_H - totalLaneH * laneScale) / 2);
            const laneYMap = {};
            laneFlows.forEach(f => {
              const srcPos = flowSrcY[f.ticker + ">" + f.from + ">" + f.to];
              const scaledH = Math.max(1.5, (srcPos?.h || 1) * laneScale);
              const key = f.ticker + ">" + f.from + ">" + f.to;
              laneYMap[key] = { y: laneOffset, h: scaledH };
              laneOffset += scaledH + 0.5;
            });

            // Build ribbons
            companyFlows.forEach(f => {
              const src = allGroups.find(g => g.id === f.from);
              const dst = allGroups.find(g => g.id === f.to);
              if (!src || !dst) return;
              const key = f.ticker + ">" + f.from + ">" + f.to;
              const srcPos = flowSrcY[key];
              const dstPos = flowDstY[key];
              if (!srcPos || !dstPos) return;
              const sY = srcPos.y, bH = srcPos.h, dY = dstPos.y, dH = dstPos.h;
              const sx = src.cx + nodeW, dx = dst.cx, gap = dx - sx;
              const lanePos = laneYMap[key]; // null if not a lane flow
              const isLane = !!lanePos;
              let d;

              if (isLane) {
                // Cross-side flow: two smooth cubics meeting at the lane waypoint.
                // Control points are placed so the tangents at the join are horizontal,
                // making the join invisibly smooth. No rigid L segment.
                const laneY = lanePos.y, laneH = lanePos.h;
                const midX = sx + gap * 0.5;
                const f1 = 0.45; // control point fraction
                // Top edge: source → (midX, laneY) → destination
                // Bottom edge: source+bH → (midX, laneY+laneH) → destination+dH
                d = `M${sx},${sY}
                     C${sx+gap*f1},${sY} ${sx+gap*f1},${laneY} ${midX},${laneY}
                     C${dx-gap*f1},${laneY} ${dx-gap*f1},${dY} ${dx},${dY}
                     L${dx},${dY+dH}
                     C${dx-gap*f1},${dY+dH} ${dx-gap*f1},${laneY+laneH} ${midX},${laneY+laneH}
                     C${sx+gap*f1},${laneY+laneH} ${sx+gap*f1},${sY+bH} ${sx},${sY+bH} Z`;
              } else if (Math.abs(gap) < 15) {
                d = `M${sx},${sY} C${sx+40},${sY} ${sx+40},${dY} ${dx},${dY} L${dx},${dY+dH} C${sx+40},${dY+dH} ${sx+40},${sY+bH} ${sx},${sY+bH} Z`;
              } else if (gap < 0) {
                const ag = Math.abs(gap);
                d = `M${sx},${sY} C${sx-ag*0.3},${sY} ${dx+ag*0.3},${dY} ${dx},${dY} L${dx},${dY+dH} C${dx+ag*0.3},${dY+dH} ${sx-ag*0.3},${sY+bH} ${sx},${sY+bH} Z`;
              } else {
                // Natural bezier — works for short AND long same-side flows.
                // Slightly looser curvature for long flows to avoid pinching.
                const cv = gap > 400 ? 0.32 : gap > 250 ? 0.36 : gap > 150 ? 0.40 : 0.42;
                d = `M${sx},${sY} C${sx+gap*cv},${sY} ${dx-gap*cv},${dY} ${dx},${dY} L${dx},${dY+dH} C${dx-gap*cv},${dY+dH} ${sx+gap*cv},${sY+bH} ${sx},${sY+bH} Z`;
              }
              allRibbons.push({ d, color: f.color, ticker: f.ticker, from: f.from, to: f.to, value: f.value, bH, midX: (sx+dx)/2, midY: isLane ? LANE_CENTER : (sY+dY)/2, isExpress: isLane });
            });

            // State
            const isGrpMode = focused && focused.startsWith("g:");
            const focGrpId = isGrpMode ? focused.slice(2) : null;
            const focGrp = focGrpId ? allGroups.find(g => g.id === focGrpId) : null;
            const active = (isGrpMode ? null : focused) || hoverTicker;
            const activeCo = active ? COMPANIES.find(c => c.t === active) : null;
            const activeBrand = active ? (BRAND[active] || ["#888"])[0] : null;
            const anyFocus = active || focGrpId;

            // Total rev per stage for percentage calc
            const stageRevs = stages.map(st => st.groups.reduce((a, g) => a + g.rev, 0));

            return (
              <div style={{ position: "relative" }}>
                {(focused || focGrpId) && (
                  <button onClick={() => { setFocused(null); setHoverTicker(null); }} style={{
                    position: "absolute", top: 4, right: 6, zIndex: 5, background: "#fff",
                    border: "1px solid rgba(0,0,0,.1)", borderRadius: 6, padding: "3px 10px",
                    fontSize: 10, color: "#666", cursor: "pointer",
                    boxShadow: "0 2px 8px rgba(0,0,0,.08)", fontWeight: 600,
                  }}>✕ Back</button>
                )}

                <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", minWidth: 540 }}
                  onClick={() => { setFocused(null); setHoverTicker(null); }}>
                  <defs>
                    <filter id="nodeShadow" x="-50%" y="-50%" width="200%" height="200%">
                      <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodOpacity="0.15" />
                    </filter>
                  </defs>

                  {/* Ribbons */}
                  {allRibbons.map((r, i) => {
                    const isAct = active && r.ticker === active;
                    const isGrpHit = focGrpId && (r.from === focGrpId || r.to === focGrpId);
                    const lit = isAct || isGrpHit;
                    const op = anyFocus ? (lit ? 0.6 : 0.02) : Math.min(0.45, 0.22 + r.bH * 0.016);
                    return (
                      <path key={i} d={r.d} fill={r.color} fillOpacity={op}
                        stroke={r.color} strokeWidth={lit ? 0.8 : 0} strokeOpacity={0.3}
                        style={{ cursor: "pointer", transition: "fill-opacity 0.3s ease" }}
                        onMouseEnter={() => { if (!focused && !focGrpId) setHoverTicker(r.ticker); }}
                        onMouseLeave={() => { if (!focused) setHoverTicker(null); }}
                        onClick={e => { e.stopPropagation(); setFocused(focused === r.ticker ? null : r.ticker); }}>
                        <title>{r.ticker}: {allGroups.find(g=>g.id===r.from)?.label} → {allGroups.find(g=>g.id===r.to)?.label} — {fmtMC(r.value)}</title>
                      </path>
                    );
                  })}

                  {/* Solid node bars + labels */}
                  {allGroups.map(g => {
                    const gHasActive = active && g.tickers.includes(active);
                    const isGrpFocus = focGrpId === g.id;
                    const stageIdx = stages.findIndex(st => st.groups.some(gg => gg.id === g.id));
                    const stageTotal = stageRevs[stageIdx] || 1;
                    const pct = (g.rev / stageTotal * 100).toFixed(0);
                    const dimmed = anyFocus && !gHasActive && !isGrpFocus;
                    return (
                      <g key={g.id} style={{ cursor: "pointer" }}
                        onClick={e => { e.stopPropagation(); setFocused(isGrpFocus ? null : "g:" + g.id); }}>
                        {/* Solid colored bar */}
                        <rect x={g.cx} y={g.y} width={nodeW} height={g.h} rx={3}
                          filter={dimmed ? "none" : "url(#nodeShadow)"}
                          fill={g.bc} fillOpacity={dimmed ? 0.15 : 0.92}
                          stroke={isGrpFocus ? "#222" : gHasActive ? activeBrand : "rgba(0,0,0,.08)"}
                          strokeWidth={isGrpFocus || gHasActive ? 1.5 : 0.5}
                          style={{ transition: "fill-opacity 0.3s ease" }} />
                        {/* Two-line external label with percentage */}
                        {(() => {
                          const isRight = stageIdx < 6;
                          const lx = isRight ? g.cx + nodeW + 7 : g.cx - 7;
                          const anchor = isRight ? "start" : "end";
                          return (
                            <g opacity={dimmed ? 0.15 : 1} style={{ transition: "opacity 0.3s ease", pointerEvents: "none" }}>
                              <text x={lx} y={g.y + g.h / 2 - 4} fontSize={11} textAnchor={anchor}
                                fontFamily="Arial, Helvetica, sans-serif" fill="#1a1a1a" fontWeight={700}
                                dominantBaseline="middle">{g.label}</text>
                              <text x={lx} y={g.y + g.h / 2 + 9} fontSize={9.5} textAnchor={anchor}
                                fontFamily="Arial, Helvetica, sans-serif" dominantBaseline="middle">
                                <tspan fill="#333" fontWeight={600}>{pct}%</tspan>
                                <tspan fill="#999"> · {fmtMC(g.rev)}</tspan>
                              </text>
                            </g>
                          );
                        })()}
                      </g>
                    );
                  })}

                  {/* Revenue labels on major flows */}
                  {!anyFocus && (() => {
                    const pt = {};
                    allRibbons.forEach(r => {
                      const k = r.from + ">" + r.to;
                      if (!pt[k]) pt[k] = { total: 0, mx: 0, my: 999, n: 0 };
                      pt[k].total += r.value; pt[k].mx += r.midX; pt[k].n++;
                      pt[k].my = Math.min(pt[k].my, r.midY);
                    });
                    return Object.values(pt).map(p => ({ ...p, mx: p.mx / p.n }))
                      .sort((a, b) => b.total - a.total).slice(0, 5)
                      .map((p, i) => (
                        <text key={"fl"+i} x={p.mx} y={p.my - 5} textAnchor="middle"
                          fontSize={9} fill="#bbb" fontWeight={600} fontFamily="Arial, Helvetica, sans-serif"
                          style={{ pointerEvents: "none" }}>{fmtMC(p.total)}</text>
                      ));
                  })()}

                  {/* Stage headers at TOP - clean, uppercase, tracked */}
                  {stages.map((st, i) => {
                    const isRight = i === 6;
                    const isLeft = i === 0;
                    const cx = colX[i] + nodeW / 2;
                    const stageColor = st.groups[0]?.bc || "#888";
                    return (
                      <g key={"hdr"+i}>
                        {/* Subtle accent dot */}
                        <circle cx={cx} cy={14} r={2.5} fill={stageColor} fillOpacity={0.8} />
                        {/* Stage label */}
                        <text x={cx} y={27}
                          textAnchor={isLeft ? "start" : isRight ? "end" : "middle"}
                          fontSize={9.5} fill="#888" fontWeight={700}
                          fontFamily="Arial, Helvetica, sans-serif"
                          style={{ letterSpacing: "0.08em", textTransform: "uppercase" }}>
                          {isLeft ? (
                            <tspan x={colX[i]}>{st.label.toUpperCase()}</tspan>
                          ) : isRight ? (
                            <tspan x={colX[i] + nodeW}>{st.label.toUpperCase()}</tspan>
                          ) : st.label.toUpperCase()}
                        </text>
                      </g>
                    );
                  })}
                  {/* Thin divider line beneath stage headers */}
                  <line x1={4} x2={W - 4} y1={32} y2={32} stroke="#eee" strokeWidth={1} />
                </svg>

                {/* Hover tooltip */}
                {hoverTicker && !focused && (() => {
                  const co = COMPANIES.find(c => c.t === hoverTicker);
                  if (!co) return null;
                  const price = SP[hoverTicker] || 0;
                  const rr = allRibbons.filter(r => r.ticker === hoverTicker);
                  const ax = rr.length ? rr.reduce((a, r) => a + r.midX, 0) / rr.length : W / 2;
                  const ay = rr.length ? Math.min(...rr.map(r => r.midY)) : H / 2;
                  return (
                    <div style={{
                      position: "absolute", left: Math.min(Math.max(8, ax/W*100), 72)+"%",
                      top: Math.max(0, ay/H*100 - 8)+"%",
                      background: "#fff", border: "1px solid " + (BRAND[hoverTicker]||["#888"])[0] + "44",
                      borderRadius: 8, padding: "5px 8px", pointerEvents: "none",
                      boxShadow: "0 4px 16px rgba(0,0,0,.12)", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
                    }}>
                      <Logo ticker={hoverTicker} size={20} />
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#111" }}>{co.cc} {hoverTicker}</div>
                        <div style={{ fontSize: 10, color: "#888" }}>${price >= 100 ? price.toFixed(0) : price.toFixed(2)} · {fmtMC(co.r)} rev</div>
                      </div>
                    </div>
                  );
                })()}

                {/* Group card */}
                {focGrp && (() => {
                  const gCos = focGrp.tickers.map(t => COMPANIES.find(co => co.t === t)).filter(Boolean).sort((a, b) => b.r - a.r);
                  const inT = groupFlows.filter(f => f.to === focGrpId).reduce((a, f) => a + f.total, 0);
                  const outT = groupFlows.filter(f => f.from === focGrpId).reduce((a, f) => a + f.total, 0);
                  return (
                    <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)",
                      background: "#fff", border: "1px solid rgba(0,0,0,.1)", borderRadius: 12,
                      padding: "10px 14px", minWidth: 320, maxWidth: 480,
                      boxShadow: "0 8px 32px rgba(0,0,0,.14)", zIndex: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, paddingBottom: 6, borderBottom: "2px solid " + focGrp.bc }}>
                        <span style={{ fontSize: 14, fontWeight: 700 }}>{focGrp.label}</span>
                        <span style={{ fontSize: 12, color: "#999" }}>{focGrp.tickers.length} cos · {fmtMC(focGrp.rev)}</span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, marginBottom: 6 }}>
                        {[["INFLOWS", inT], ["GROUP REV", focGrp.rev], ["OUTFLOWS", outT]].map(([l, v]) => (
                          <div key={l} style={{ textAlign: "center", padding: 3, background: "rgba(0,0,0,.015)", borderRadius: 4 }}>
                            <div style={{ fontSize: 9, color: "#aaa", fontWeight: 600 }}>{l}</div>
                            <div style={{ fontSize: 12, fontWeight: 700 }}>{fmtMC(v)}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 4 }}>
                        {gCos.map(co => {
                          const price = SP[co.t] || 0;
                          const pct = focGrp.rev > 0 ? (co.r / focGrp.rev * 100).toFixed(0) : 0;
                          return (
                            <div key={co.t} onClick={e => { e.stopPropagation(); setFocused(co.t); }}
                              style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 6px", cursor: "pointer", borderRadius: 6, border: "1px solid rgba(0,0,0,.04)" }}
                              onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,.02)"}
                              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                              <Logo ticker={co.t} size={18} />
                              <div>
                                <div style={{ fontSize: 11, fontWeight: 700 }}>{co.t} <span style={{ fontWeight: 400, color: "#999", fontSize: 10 }}>{pct}%</span></div>
                                <div style={{ fontSize: 10, color: "#888" }}>${price >= 100 ? price.toFixed(0) : price.toFixed(2)}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Company card */}
                {!isGrpMode && focused && activeCo && (() => {
                  const price = SP[focused] || 0;
                  const vc = VX[activeCo.v];
                  const suppliers = EDGES.filter(([, t]) => t === focused).map(([s, l]) => ({ t: s, l }));
                  const customers = EDGES.filter(([s]) => s === focused).map(([, t, l]) => ({ t, l }));
                  return (
                    <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)",
                      background: "#fff", border: "1px solid rgba(0,0,0,.1)", borderRadius: 12,
                      padding: "10px 14px", minWidth: 320, maxWidth: 440,
                      boxShadow: "0 8px 32px rgba(0,0,0,.14)", zIndex: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <Logo ticker={focused} size={28} />
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700 }}>{activeCo.cc} {focused} <span style={{ fontWeight: 400, color: "#888", fontSize: 12 }}>{activeCo.nm}</span></div>
                          <div style={{ fontSize: 11, color: vc.c }}>{vc.n} · {activeCo.s}</div>
                        </div>
                        <div style={{ marginLeft: "auto", textAlign: "right" }}>
                          <div style={{ fontSize: 16, fontWeight: 700 }}>${price >= 100 ? price.toFixed(0) : price.toFixed(2)}</div>
                          <div style={{ fontSize: 10, color: "#999" }}>{fmtMC(activeCo.r)} rev</div>
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: "#555", lineHeight: 1.4, padding: "4px 0", borderTop: "1px solid rgba(0,0,0,.05)", fontStyle: "italic" }}>{activeCo.pr}</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 3, padding: "5px 0", borderBottom: "1px solid rgba(0,0,0,.05)" }}>
                        {[["MC", fmtMC(activeCo.mc)], ["P/E", activeCo.pe ? activeCo.pe + "x" : "—"], ["GM", activeCo.g + "%"], ["Growth", (activeCo.fin?.rg?.[4] > 0 ? "+" : "") + (activeCo.fin?.rg?.[4] || 0) + "%"]].map(([l, v]) => (
                          <div key={l} style={{ textAlign: "center" }}>
                            <div style={{ fontSize: 9, color: "#aaa", fontWeight: 600 }}>{l}</div>
                            <div style={{ fontSize: 11, fontWeight: 700 }}>{v}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 4 }}>
                        {[["SUPPLIERS", suppliers], ["CUSTOMERS", customers]].map(([label, list]) => (
                          <div key={label}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: "#aaa", marginBottom: 2 }}>{label} ({list.length})</div>
                            {list.slice(0, 5).map(s => (
                              <div key={s.t + s.l} onClick={e => { e.stopPropagation(); setFocused(s.t); }}
                                style={{ fontSize: 10, color: "#555", padding: "2px 0", cursor: "pointer", display: "flex", gap: 3, alignItems: "center" }}
                                onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,.03)"}
                                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                                <Logo ticker={s.t} size={12} /><span style={{ fontWeight: 600 }}>{s.t}</span><span style={{ color: "#bbb", fontSize: 9 }}>{s.l}</span>
                              </div>
                            ))}
                            {list.length > 5 && <div style={{ fontSize: 9, color: "#bbb" }}>+{list.length - 5} more</div>}
                          </div>
                        ))}
                      </div>
                      <button onClick={e => { e.stopPropagation(); onSelect && onSelect(focused); setFocused(null); }}
                        style={{ marginTop: 8, width: "100%", background: vc.c, border: "none", borderRadius: 6, padding: "6px 0",
                          color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                        View full analysis →
                      </button>
                    </div>
                  );
                })()}
              </div>
            );
          })()}
        </div>
      </div>

    </>
  );
}

function MarketSummary({ onFilterVertical, onSelect, theme, liveData = {}, liveFund = {} }) {
  const lbl = { fontSize: 11, fontWeight: 600, color: "#999", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 6 };
  const card = { background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 10, boxShadow: "0 1px 3px rgba(0,0,0,.03)" };

  const themeVerticals = theme?.verticals || AI_VERTICALS;
  const themeCos = COMPANIES.filter(c => themeMatchesCompany(theme || THEMES.ai, c));
  const macroAxes = theme?.macro || AI_MACRO;
  const primaryMacroKey = macroAxes[Math.min(2, macroAxes.length - 1)]?.k || "ai";
  const primaryMacroName = macroAxes[Math.min(2, macroAxes.length - 1)]?.n || "AI Capex";

  // Prefer live values from FMP quote/fund endpoints; fall back to authored
  const effMC = (c) => liveData[c.t]?.mc ?? c.mc;
  const effRev = (c) => liveFund[c.t]?.revenueTTM ?? c.r;
  const effGM = (c) => liveFund[c.t]?.grossMarginTTM ?? c.g;
  const effPE = (c) => liveData[c.t]?.pe ?? c.pe;

  const totalMC = themeCos.reduce((a, c) => a + effMC(c), 0);
  const totalRev = themeCos.reduce((a, c) => a + (effRev(c) || 0), 0);
  const profitable = themeCos.filter(c => effPE(c) != null && effPE(c) > 0);
  const medPE = profitable.length ? profitable.map(c => effPE(c)).sort((a, b) => a - b)[Math.floor(profitable.length / 2)] : 0;
  const avgMacro = themeCos.length ? (themeCos.reduce((a, c) => a + (c.ms?.[primaryMacroKey] || 0), 0) / themeCos.length * 100).toFixed(0) : 0;

  const verts = Object.entries(themeVerticals).map(([k, v]) => {
    const cs = themeCos.filter(c => resolveCompanyVertical(c, theme) === k);
    const mc = cs.reduce((a, c) => a + effMC(c), 0);
    const rev = cs.reduce((a, c) => a + (effRev(c) || 0), 0);
    const gm = cs.length ? +(cs.reduce((a, c) => a + (effGM(c) || 0), 0) / cs.length).toFixed(1) : 0;
    return { k, name: v.n, color: v.c, count: cs.length, mc, rev, gm, cos: cs };
  }).sort((a, b) => b.mc - a.mc);

  // Supply chain density
  const vKeys = Object.keys(VX);
  const density = {};
  vKeys.forEach(a => vKeys.forEach(b => { density[a + ">" + b] = 0; }));
  EDGES.forEach(([s, t]) => {
    const sv = COMPANIES.find(c => c.t === s)?.v;
    const tv = COMPANIES.find(c => c.t === t)?.v;
    if (sv && tv) density[sv + ">" + tv]++;
  });
  const maxD = Math.max(...Object.values(density), 1);

  // Scatter data
  const scatterData = COMPANIES.filter(c => c.pe != null && c.pe < 200).map(c => ({
    name: c.t, cc: c.cc, pe: c.pe, growth: c.fin?.rg?.[4] || 0, mc: c.mc, color: VX[c.v].c, v: VX[c.v].n,
  }));

  // Sorted companies for treemap
  const sorted = [...COMPANIES].sort((a, b) => b.mc - a.mc);

  // Profitability data sorted
  const profData = [...verts].sort((a, b) => a.gm - b.gm);

  const mcDonut = verts.map(v => ({ name: v.name, value: v.mc, color: v.color, pct: (v.mc / totalMC * 100) }));
  const revDonut = verts.map(v => ({ name: v.name, value: v.rev, color: v.color, pct: (v.rev / totalRev * 100) }));

  return (
    <div style={{ marginTop: 12 }}>
      {/* ═══ ROW 1: HEADLINE METRICS ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 14 }}>
        {[
          ["Total Market Cap", fmtMC(totalMC), "#111", "#1a8a5c"],
          ["Combined Revenue", fmtMC(totalRev), "#111", "#5E94E8"],
          ["Median P/E", medPE.toFixed(1) + "x", "#111", "#b8860b"],
          ["Avg " + primaryMacroName, avgMacro + "%", "#b8860b", theme?.accent || "#CDA24E"],
        ].map(([label, value, color, accent]) => (
          <div key={label} style={{ ...card, padding: "7px 10px" }}>
            <div style={{ fontSize: 10, color: "#999", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
            <div style={{ height: 2, borderRadius: 1, background: accent, opacity: 0.3, marginTop: 4 }} />
          </div>
        ))}
      </div>

      {/* ═══ ROW 2: ECOSYSTEM HEATMAP ═══ */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
          <div style={lbl}>Ecosystem heatmap</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, color: "#c44040" }}>\u25C0 Declining</span>
            <div style={{ display: "flex", gap: 1 }}>
              {[-30,-15,0,15,30,60,100].map(g => (
                <div key={g} style={{ width: 10, height: 6, borderRadius: 1,
                  background: g < 0 ? `rgba(196,64,64,${0.3 + Math.abs(g)/60})` : g === 0 ? "rgba(0,0,0,.1)" : `rgba(26,138,92,${0.2 + g/150})`,
                }} />
              ))}
            </div>
            <span style={{ fontSize: 10, color: "#1a8a5c" }}>Growing \u25B6</span>
          </div>
        </div>
        <div style={{ background: "#1a1a1a", borderRadius: 10, padding: 6, overflow: "hidden" }}>
          {verts.map(v => {
            const cosSorted = [...v.cos].sort((a, b) => b.mc - a.mc);
            return (
              <div key={v.k} style={{ marginBottom: 2 }}>
                <div style={{ display: "flex", gap: 1.5, height: 38 }}>
                  {/* Vertical label cell */}
                  <div onClick={() => onFilterVertical && onFilterVertical(v.k)}
                    style={{ width: 56, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end",
                      justifyContent: "center", padding: "0 5px", cursor: "pointer", borderRadius: 3,
                      background: v.color + "15", borderRight: "2px solid " + v.color }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: v.color, lineHeight: 1.2 }}>{v.name}</span>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,.3)" }}>{v.count} cos</span>
                  </div>
                  {/* Company cells */}
                  {cosSorted.map(c => {
                    const pct = Math.max(1.5, (c.mc / v.mc) * 100);
                    const gr = c.fin?.rg?.[4] || 0;
                    const price = SP[c.t] || (c.mc / (c.dc?.sh || 1));
                    // Diverging color: red for negative, green for positive growth
                    const bg = gr < -10 ? `rgba(196,64,64,${Math.min(0.9, 0.4 + Math.abs(gr)/80)})`
                      : gr < 0 ? `rgba(196,64,64,${0.25 + Math.abs(gr)/40})`
                      : gr < 10 ? `rgba(255,255,255,${0.06 + gr/100})`
                      : gr < 40 ? `rgba(26,138,92,${0.15 + gr/120})`
                      : `rgba(26,138,92,${Math.min(0.85, 0.3 + gr/150)})`;
                    const textColor = gr < -5 ? "#fca5a5" : gr < 10 ? "rgba(255,255,255,.6)" : gr < 40 ? "#a7f3d0" : "#6ee7b7";
                    const br = BRAND[c.t] || [v.color, c.t.slice(0,2)];
                    return (
                      <div key={c.t} onClick={() => onSelect && onSelect(c.t)}
                        style={{
                          flex: `${pct} 0 0`, minWidth: 22, background: bg,
                          borderRadius: 3, display: "flex", flexDirection: "column",
                          justifyContent: "center", padding: "0 3px", cursor: "pointer",
                          overflow: "hidden", transition: "all 0.12s", position: "relative",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.outline = "1.5px solid " + v.color; e.currentTarget.style.zIndex = "5"; e.currentTarget.style.transform = "scale(1.03)"; }}
                        onMouseLeave={e => { e.currentTarget.style.outline = "none"; e.currentTarget.style.zIndex = "0"; e.currentTarget.style.transform = "none"; }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", textShadow: "0 1px 3px rgba(0,0,0,.5)", letterSpacing: 0.3 }}>{c.t}</span>
                          {pct > 12 && <span style={{ fontSize: 10, color: textColor, marginLeft: "auto" }}>{gr > 0 ? "+" : ""}{gr}%</span>}
                        </div>
                        {pct > 6 && (
                          <span style={{ fontSize: 11, color: "rgba(255,255,255,.55)", marginTop: 1 }}>
                            ${price >= 1000 ? Math.round(price).toLocaleString() : price >= 100 ? price.toFixed(0) : price.toFixed(2)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══ ROW 3: INTERACTIVE SVG DONUTS ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        {[["Market Cap Share", mcDonut, totalMC], ["Revenue Share", revDonut, totalRev]].map(([title, data, total]) => {
          // SVG arc builder
          const R = 42, r = 24, cx = 48, cy = 48;
          let cumAngle = -Math.PI / 2;
          const arcs = data.map(d => {
            const angle = (d.value / total) * Math.PI * 2;
            const start = cumAngle;
            cumAngle += angle;
            const end = cumAngle;
            const large = angle > Math.PI ? 1 : 0;
            const x1 = cx + R * Math.cos(start), y1 = cy + R * Math.sin(start);
            const x2 = cx + R * Math.cos(end), y2 = cy + R * Math.sin(end);
            const x3 = cx + r * Math.cos(end), y3 = cy + r * Math.sin(end);
            const x4 = cx + r * Math.cos(start), y4 = cy + r * Math.sin(start);
            const path = `M${x1},${y1} A${R},${R} 0 ${large},1 ${x2},${y2} L${x3},${y3} A${r},${r} 0 ${large},0 ${x4},${y4} Z`;
            return { ...d, path };
          });
          return (
            <div key={title} style={{ ...card, padding: 10 }}>
              <div style={{ ...lbl, marginBottom: 6 }}>{title}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <svg width={96} height={96} viewBox="0 0 96 96" style={{ flexShrink: 0 }}>
                  {arcs.map(d => (
                    <path key={d.name} d={d.path} fill={d.color} fillOpacity={0.7} stroke="#fff" strokeWidth={1.5}
                      style={{ cursor: "pointer", transition: "fill-opacity 0.15s" }}
                      onClick={() => onFilterVertical && onFilterVertical(verts.find(v => v.name === d.name)?.k)}
                      onMouseEnter={e => e.target.setAttribute("fill-opacity", "1")}
                      onMouseLeave={e => e.target.setAttribute("fill-opacity", "0.7")} />
                  ))}
                  <circle cx={cx} cy={cy} r={r - 2} fill="#ffffff" />
                  <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle" fontSize={10} fontWeight={700} fill="#333" fontFamily="Arial, Helvetica, sans-serif">{fmtMC(total)}</text>
                </svg>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
                  {data.map(d => (
                    <div key={d.name} onClick={() => onFilterVertical && onFilterVertical(verts.find(v => v.name === d.name)?.k)}
                      style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", padding: "1px 0", borderRadius: 3 }}
                      onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,.03)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: d.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 10, color: "#666", flex: 1 }}>{d.name}</span>
                      <span style={{ fontSize: 10, color: "#333", fontWeight: 600 }}>{d.pct.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ═══ ROW 4: VERTICAL FINANCIAL COMPARISON ═══ */}
      <div style={{ marginBottom: 14 }}>
        <div style={lbl}>Vertical comparison</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
          {[...verts].sort((a, b) => b.mc - a.mc).slice(0, 4).map(v => {
            const topCos = [...v.cos].sort((a, b) => b.mc - a.mc).slice(0, 4);
            const avgGr = v.cos.length ? Math.round(v.cos.reduce((a, c) => a + (c.fin?.rg?.[4] || 0), 0) / v.cos.length) : 0;
            return (
              <div key={v.k} onClick={() => onFilterVertical && onFilterVertical(v.k)}
                style={{ ...card, padding: 8, cursor: "pointer", transition: "border-color 0.15s" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = v.color + "44"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(0,0,0,.05)"}>
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: v.color }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: v.color }}>{v.name}</span>
                  <span style={{ fontSize: 10, color: "#bbb", marginLeft: "auto" }}>{v.count}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, marginBottom: 6 }}>
                  {[["GM", v.gm + "%"], ["Growth", (avgGr > 0 ? "+" : "") + avgGr + "%"], ["MC", fmtMC(v.mc)], ["Rev", fmtMC(v.rev)]].map(([l, val]) => (
                    <div key={l} style={{ background: "rgba(0,0,0,.018)", borderRadius: 4, padding: "2px 4px" }}>
                      <div style={{ fontSize: 10, color: "#999", textTransform: "uppercase" }}>{l}</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#333" }}>{val}</div>
                    </div>
                  ))}
                </div>
                <div style={{ borderTop: "1px solid rgba(0,0,0,.04)", paddingTop: 4 }}>
                  {topCos.map(c => (
                    <div key={c.t} onClick={e => { e.stopPropagation(); onSelect && onSelect(c.t); }}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1px 0", cursor: "pointer" }}>
                      <span style={{ fontSize: 11, color: "#555" }}><Logo ticker={c.t} size={10} style={{ marginRight: 2 }} />{c.t}</span>
                      <span style={{ fontSize: 11, color: "#888" }}>{fmtMC(c.mc)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginTop: 6 }}>
          {[...verts].sort((a, b) => b.mc - a.mc).slice(4).map(v => {
            const avgGr = v.cos.length ? Math.round(v.cos.reduce((a, c) => a + (c.fin?.rg?.[4] || 0), 0) / v.cos.length) : 0;
            return (
              <div key={v.k} onClick={() => onFilterVertical && onFilterVertical(v.k)}
                style={{ ...card, padding: 6, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
                onMouseEnter={e => e.currentTarget.style.borderColor = v.color + "44"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(0,0,0,.05)"}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: v.color, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: v.color }}>{v.name}</div>
                  <div style={{ fontSize: 11, color: "#888" }}>{v.count} cos &middot; {v.gm}% GM &middot; {avgGr > 0 ? "+" : ""}{avgGr}%</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#333" }}>{fmtMC(v.mc)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══ ROW 5: VALUATION SCATTER ═══ */}
      <div style={{ marginBottom: 14 }}>
        <div style={lbl}>Valuation spectrum: P/E vs growth</div>
        <div style={{ ...card, padding: "8px 4px" }}>
          <ResponsiveContainer width="100%" height={200}>
            <ScatterChart margin={{ top: 14, right: 16, bottom: 8, left: 0 }}>
              <XAxis type="number" dataKey="pe" name="P/E" tick={{ fontSize: 10, fill: "#999" }} axisLine={{ stroke: "#e0e0e0" }} tickLine={false}
                label={{ value: "P/E Ratio", position: "bottom", fontSize: 10, fill: "#aaa", offset: -2 }} />
              <YAxis type="number" dataKey="growth" name="Growth" tick={{ fontSize: 10, fill: "#999" }} axisLine={false} tickLine={false}
                label={{ value: "Rev Growth %", angle: -90, position: "insideLeft", fontSize: 10, fill: "#aaa", offset: 10 }} />
              <ZAxis type="number" dataKey="mc" range={[30, 500]} />
              <Tooltip cursor={false} content={({ payload }) => {
                if (!payload?.[0]) return null;
                const d = payload[0].payload;
                return (
                  <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.08)", borderRadius: 6, padding: "5px 7px", fontSize: 10 }}>
                    <div style={{ fontWeight: 700, color: d.color, display: "flex", alignItems: "center", gap: 4 }}>
                      <Logo ticker={d.name} size={14} />{d.cc} ${d.name} <span style={{ fontWeight: 400, color: "#999", fontSize: 10 }}>{d.v}</span>
                    </div>
                    <div style={{ color: "#555" }}>P/E: {d.pe}x &middot; Growth: {d.growth > 0 ? "+" : ""}{d.growth}% &middot; {fmtMC(d.mc)}</div>
                  </div>
                );
              }} />
              <Scatter data={scatterData}>
                {scatterData.map((d, i) => <Cell key={i} fill={d.color} fillOpacity={0.6} stroke={d.color} strokeWidth={0.5} />)}
                <LabelList dataKey="name" position="top" style={{ fontSize: 11, fontWeight: 600, fill: "#888" }} offset={6} />
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ═══ ROW 6: VALUE STREAM ═══ */}
      <ValueStreamSankey theme={theme} onSelect={onSelect} />
      {/* ═══ ROW 7: MACRO EXPOSURE ═══ */}
      <div>
        <div style={lbl}>Macro exposure by vertical</div>
        <div style={{ ...card, padding: 8, overflowX: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "100px repeat(" + macroAxes.length + ", 1fr)", gap: 2 }}>
            <div />
            {macroAxes.map(m => <div key={m.k} style={{ padding: "3px 0", textAlign: "center", fontSize: 10, color: "#999", fontWeight: 600, textTransform: "uppercase" }}>{m.n}</div>)}
            {verts.map(v => [
              <div key={v.k + "n"} onClick={() => onFilterVertical && onFilterVertical(v.k)}
                style={{ padding: "3px 4px", fontSize: 10, color: v.color, fontWeight: 600, display: "flex", alignItems: "center", cursor: "pointer", borderRadius: 3 }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,.04)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: v.color, marginRight: 4, flexShrink: 0 }} />
                {v.name} <span style={{ color: "#bbb", marginLeft: 3, fontWeight: 400 }}>({v.count})</span>
              </div>,
              ...macroAxes.map(m => {
                const mk = m.k;
                const val = v.count ? Math.round(v.cos.reduce((a, c) => a + (c.ms?.[mk] || 0), 0) / v.count * 100) : 0;
                const bg = val > 70 ? "rgba(196,64,64," + (val/180) + ")" : val > 40 ? "rgba(184,134,11," + (val/220) + ")" : "rgba(26,138,92," + (val/280) + ")";
                return <div key={v.k + mk} style={{ background: bg, borderRadius: 3, padding: "3px 0", textAlign: "center", fontSize: 10, color: val > 50 ? "#fff" : "#444", fontWeight: 600 }}>{val}</div>;
              }),
            ])}
          </div>
        </div>
      </div>
    </div>
  );
}

// AI theme — sankey value stream stages (extracted from the previous hard-coded
// version inside MarketSummary, now per-theme so other themes can ship their own).

// Defense theme — sankey value stream

// Nuclear theme — sankey value stream

// Drones theme — sankey

// Space theme — sankey

// Robotics theme — sankey

// Quantum theme — sankey

// Biotech GLP-1 theme — sankey

// Batteries theme — sankey

// Uranium theme — sankey

// Crypto theme — sankey

// Curated 6-theme view. Other themes (defense/drones/uranium/batteries/biotech/crypto
// + physical_ai/ai_stack/energy_transition metas) remain in THEMES for data integrity
// and for aerospace_defense meta's constituent lookup, but aren't shown in the switcher.

/* ════════════════════════ FORCE GRAPH ════════════════════════ */
/* ═════════════════ GRAPH HELPERS ═════════════════ */
// Auto-layout fallback for meta-themes with empty POS — grids by vertical
// so nodes don't pile at canvas center and explode outward.
function computeAutoPos(cos, theme, W, H) {
  const vGroups = {};
  cos.forEach(c => {
    const v = resolveCompanyVertical(c, theme);
    (vGroups[v] = vGroups[v] || []).push(c.t);
  });
  const vKeys = Object.keys(theme?.verticals || {}).filter(k => vGroups[k]);
  const rowH = vKeys.length ? (H - 40) / vKeys.length : 60;
  const autoPos = {};
  vKeys.forEach((vk, row) => {
    const y = 40 + row * rowH + rowH / 2;
    const tickers = vGroups[vk] || [];
    const cols = Math.min(tickers.length, Math.max(4, Math.ceil(Math.sqrt(tickers.length * 2))));
    const colW = (W - 80) / Math.max(cols, 1);
    tickers.forEach((t, i) => {
      const col = i % cols;
      const rowOff = Math.floor(i / cols) * 22;
      autoPos[t] = [60 + col * colW + colW / 2, y - rowOff];
    });
  });
  return autoPos;
}

// Top-right toolbar: color mode toggles + reset button.
// Separated from Graph so the color mode / reset UI is easier to locate and edit.
function GraphToolbar({ colorMode, setColorMode, nodesRef, simRef }) {
  const modes = [["vertical","Vertical"],["pe","P/E"],["growth","Growth"],["ai","AI Exp"]];
  return (
    <div style={{ position: "absolute", top: 5, right: 8, display: "flex", gap: 2, zIndex: 2, alignItems: "center" }}>
      <span style={{ fontSize: 10, color: "#bbb", marginRight: 2, lineHeight: "18px" }}>Color:</span>
      {modes.map(([id, lb]) => (
        <button key={id} onClick={(e) => { e.stopPropagation(); setColorMode(id); }} style={{
          background: colorMode === id ? "rgba(0,0,0,.07)" : "transparent",
          border: "none", borderRadius: 3, padding: "1px 4px", fontSize: 10, cursor: "pointer",
          color: colorMode === id ? "#333" : "#aaa", fontWeight: 600,
        }}>{lb}</button>
      ))}
      <button
        onClick={(e) => {
          e.stopPropagation();
          // Unpin all dragged nodes and re-settle
          nodesRef.current.forEach(n => { n.fx = null; n.fy = null; });
          if (simRef.current) {
            simRef.current.alpha(0.5).restart();
            setTimeout(() => simRef.current && simRef.current.alphaTarget(0), 100);
          }
        }}
        title="Unpin all nodes and reset to authored layout"
        style={{
          background: "transparent", border: "1px solid rgba(0,0,0,.08)", borderRadius: 4,
          padding: "1px 6px", fontSize: 10, cursor: "pointer", marginLeft: 6,
          color: "#888", fontWeight: 600,
        }}>⟲ Reset</button>
    </div>
  );
}

function Graph({ cos, sel, onSel, vFilter, searchQuery, theme, liveData = {}, liveFund = {} }) {
  const POS = theme?.positions || AI_POSITIONS;
  const ZONES = theme?.zoneLabels || AI_ZONE_LABELS;
  const ref = useRef();
  const gRef = useRef();
  const tipRef = useRef();
  const nodesRef = useRef([]);
  const simRef = useRef(null);
  const [colorMode, setColorMode] = useState("vertical");
  const [zoneHl, setZoneHl] = useState(null);
  const [hovered, setHovered] = useState(null);
  const zoomLock = useRef(false);
  const W = 680, H = 390;
  const tSet = useMemo(() => new Set(cos.map(c => c.t)), [cos]);

  const peScale = useMemo(() => d3.scaleLinear().domain([8, 40, 180]).range(["#1a8a5c", "#b8860b", "#c44040"]).clamp(true), []);
  const grScale = useMemo(() => d3.scaleLinear().domain([-10, 25, 100]).range(["#c44040", "#b8860b", "#1a8a5c"]).clamp(true), []);
  const aiScale = useMemo(() => d3.scaleLinear().domain([0.3, 0.65, 1]).range(["#999", "#b8860b", "#c44040"]).clamp(true), []);

  const getColor = useCallback((d) => {
    if (colorMode === "pe") return d.pe ? peScale(d.pe) : "#ccc";
    if (colorMode === "growth") return grScale(d.fin?.rg?.[4] || 0);
    if (colorMode === "ai") return aiScale(d.ms?.ai || 0.5);
    return VX[d.v].c;
  }, [colorMode]);

  useEffect(() => {
    if (!ref.current) return;
    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();
    const g = svg.append("g");
    gRef.current = g;

    // SVG filter for selected node glow
    const defs = g.append("defs");
    defs.append("filter").attr("id", "glow").attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%")
      .append("feDropShadow").attr("dx", 0).attr("dy", 0).attr("stdDeviation", 3).attr("flood-color", "#CDA24E").attr("flood-opacity", 0.6);

    // Zone labels
    ZONES.forEach(([x, y, label], zi) => {
      g.append("line").attr("x1", 0).attr("x2", W).attr("y1", y - 6).attr("y2", y - 6)
        .attr("stroke", "#e4e4e0").attr("stroke-width", 0.4).attr("stroke-dasharray", "2,5").attr("class", "zone-line");
      const zg = g.append("g").attr("class", "zone-label").attr("cursor", "pointer")
        .on("click", (e) => { e.stopPropagation(); setZoneHl(prev => prev === zi ? null : zi); });
      zg.append("rect").attr("x", 0).attr("y", y - 4).attr("width", 120).attr("height", 18).attr("fill", "transparent");
      zg.append("text").attr("x", x).attr("y", y + 4).text(label)
        .attr("fill", "#aaa").attr("font-size", 10).attr("font-family", "Arial, Helvetica, sans-serif").attr("class", "zone-text");
    });

    // Auto-layout fallback for meta-themes (empty POS) — see computeAutoPos helper above
    const autoPos = computeAutoPos(cos, theme, W, H);

    const nodes = cos.map(c => {
      // Prefer curated positions, fall back to auto-layout grid (meta-themes), then center
      const p = POS[c.t] || autoPos[c.t];
      // Prefer live market cap from FMP quote; fall back to authored
      const effMC = liveData[c.t]?.mc ?? c.mc;
      // Preserve live revenue (TTM) + authored revenue separately — d.r conflicts with d3 radius
      const liveRev = liveFund[c.t]?.revenueTTM ?? null;
      const effRev = liveRev ?? c.r;
      const effGM = liveFund[c.t]?.grossMarginTTM ?? c.g;
      const effPE = liveData[c.t]?.pe ?? c.pe;
      return { ...c,
        r: Math.max(9, Math.min(22, Math.sqrt(effMC / 800))),
        _rev: effRev, _revIsLive: liveRev != null,
        _mc: effMC, _mcIsLive: liveData[c.t]?.mc != null,
        _gm: effGM, _gmIsLive: liveFund[c.t]?.grossMarginTTM != null,
        _pe: effPE,
        targetX: p ? p[0] : W/2, targetY: p ? p[1] : H/2,
        x: p ? p[0] + (Math.random()-.5)*8 : W/2 + (Math.random()-.5)*40,
        y: p ? p[1] + (Math.random()-.5)*8 : H/2 + (Math.random()-.5)*40 };
    });
    const links = EDGES.filter(([s, t]) => tSet.has(s) && tSet.has(t)).map(([s, t, l]) => ({ source: s, target: t, label: l }));

    // Stiffer, faster-settling simulation that stays calm during interaction.
    // Key changes from default:
    //  - velocityDecay 0.65 (default 0.4) → more damping, less oscillation
    //  - alphaDecay 0.05 (default 0.0228) → converges in ~90 ticks vs 300
    //  - charge -10 (was -15) → less repulsion cascade
    //  - position strength 0.4/0.5 (was 0.25/0.35) → stronger anchor to target
    const sim = d3.forceSimulation(nodes)
      .velocityDecay(0.65)
      .alphaDecay(0.05)
      .force("link", d3.forceLink(links).id(d => d.t).distance(30).strength(0.03))
      .force("charge", d3.forceManyBody().strength(-10).distanceMax(80))
      .force("collision", d3.forceCollide().radius(d => d.r + 3).strength(0.9))
      .force("x", d3.forceX(d => d.targetX).strength(0.4))
      .force("y", d3.forceY(d => d.targetY).strength(0.5));
    simRef.current = sim;
    nodesRef.current = nodes;

    // Edges with curved paths
    const link = g.append("g").selectAll("path").data(links).join("path")
      .attr("stroke", "#c8c8c0").attr("stroke-width", 0.6)
      .attr("stroke-dasharray", "3,3")
      .attr("stroke-opacity", 0.5)
      .attr("fill", "none")
      .style("animation", "edgeFlow 1.5s linear infinite");

    // Edge product labels (hidden until hover/select)
    const edgeLabels = g.append("g").selectAll("text").data(links).join("text")
      .attr("class", "edge-label")
      .text(d => d.label || "")
      .attr("fill", "transparent")
      .attr("font-size", 8)
      .attr("font-family", "Arial, Helvetica, sans-serif")
      .attr("text-anchor", "middle")
      .attr("pointer-events", "none");

    const node = g.append("g").selectAll("g").data(nodes).join("g").attr("cursor", "pointer");

    // Profitability ring (outer)
    node.append("circle")
      .attr("r", d => d.r + 2)
      .attr("fill", "none")
      .attr("stroke", d => d.pe != null && d.pe > 0 ? "#1a8a5c" : d.fin?.eps > 0 ? "#1a8a5c" : "#c44040")
      .attr("stroke-width", 1)
      .attr("stroke-opacity", 0.35)
      .attr("class", "profit-ring");

    // Main circle: white bg + colored ring
    node.append("circle")
      .attr("r", d => d.r)
      .attr("fill", "#fff")
      .attr("fill-opacity", 1)
      .attr("stroke", d => getColor(d))
      .attr("stroke-width", 1.5)
      .attr("class", "main-circle");

    // Branded initial circle (inside node - moves with simulation, zero lag)
    node.append("circle")
      .attr("r", d => Math.max(5, d.r * 0.7))
      .attr("fill", d => (BRAND[d.t] || ["#888"])[0])
      .attr("class", "brand-circle");

    // Brand initial text
    node.append("text")
      .text(d => (BRAND[d.t] || ["", d.t.slice(0,2)])[1])
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("fill", "#fff")
      .attr("font-size", d => Math.max(5, Math.min(9, d.r * 0.55)))
      .attr("font-weight", 700)
      .attr("font-family", "Arial, Helvetica, sans-serif")
      .attr("pointer-events", "none")
      .attr("class", "brand-text");

    // Ticker label (pushed below bubble for all sizes)
    node.append("text")
      .text(d => d.t)
      .attr("text-anchor", "middle")
      .attr("dy", d => d.r + 9)
      .attr("fill", "#777")
      .attr("font-size", d => Math.max(8, Math.min(10, d.r * 0.6)))
      .attr("font-family", "Arial, Helvetica, sans-serif").attr("font-weight", 600);

    // Data sub-label (market cap for large, P/E for medium)
    node.filter(d => d.r >= 13).append("text")
      .text(d => d.r >= 16 ? fmtMC(d._mc) : (d._pe ? d._pe + "x" : ""))
      .attr("text-anchor", "middle")
      .attr("dy", d => d.r + 17)
      .attr("fill", "#aaa")
      .attr("font-size", 7)
      .attr("font-family", "Arial, Helvetica, sans-serif");

    // Hover tooltip + connection highlighting
    node.on("mouseenter", (e, d) => {
      if (zoomLock.current) return;
      setHovered(d.t);
      const tip = tipRef.current;
      if (!tip) return;
      const vc = VX[d.v];
      const br = BRAND[d.t] || ["#888", d.t.slice(0,2)];
      const tipPrice = SP[d.t] || (d._mc / (d.dc?.sh || 1));
      // Green dot for live-sourced fields, gray for authored fallback
      const dot = (isLive) => `<span style="display:inline-block;width:4px;height:4px;border-radius:2px;background:${isLive ? '#1a8a5c' : 'rgba(0,0,0,.12)'};margin-left:4px;vertical-align:middle"></span>`;
      tip.innerHTML = `<div style="display:flex;align-items:center;gap:5px;margin-bottom:2px;"><span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:3px;background:${br[0]};color:#fff;font-size:10px;font-weight:700;font-family:'SF Mono',monospace;">${br[1]}</span><span style="font-weight:700;color:${vc.c};font-size:14px;">${d.cc || ""} $${d.t}</span><span style="font-weight:700;color:#111;font-size:14px;margin-left:auto;font-family:'SF Mono',monospace;">$${tipPrice.toFixed(2)}</span></div>` +
        `<div style="color:#666;font-size:12px;margin:3px 0 5px">${d.nm} &middot; ${vc.n}</div>` +
        `<div style="display:grid;grid-template-columns:1fr 1fr;gap:3px 14px;font-size:12px;">` +
        `<span style="color:#999">Mkt Cap</span><span style="color:#333;font-weight:600">${fmtMC(d._mc)}${dot(d._mcIsLive)}</span>` +
        `<span style="color:#999">Revenue ${d._revIsLive ? 'TTM' : ''}</span><span style="color:#333;font-weight:600">${fmtMC(d._rev)}${dot(d._revIsLive)}</span>` +
        `<span style="color:#999">GM</span><span style="color:#333;font-weight:600">${d._gm != null ? Math.round(d._gm) + '%' : '\u2014'}${dot(d._gmIsLive)}</span>` +
        `<span style="color:#999">P/E</span><span style="color:#333;font-weight:600">${d._pe ? Number(d._pe).toFixed(1) + 'x' : '\u2014'}</span>` +
        `<span style="color:#999">Growth</span><span style="color:#333;font-weight:600">${d.fin?.rg?.[4] ? '+' + d.fin.rg[4] + '%' : '\u2014'}</span>` +
        `</div>` +
        `<div style="color:#666;font-size:11px;margin-top:5px;border-top:1px solid rgba(0,0,0,.06);padding-top:4px;font-style:italic">${d.pr}</div>`;
      tip.style.display = "block";
    })
    .on("mousemove", (e, d) => {
      const tip = tipRef.current;
      if (!tip) return;
      const rect = ref.current.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      const cw = rect.width;
      const ch = rect.height;
      // Find avg position of connected nodes to avoid them
      const connNodes = nodes.filter(n => EDGES.some(([s,t]) => (s===d.t&&t===n.t)||(t===d.t&&s===n.t)));
      const scaleX = cw / W, scaleY = ch / H;
      let avgCX = mx, avgCY = my;
      if (connNodes.length > 0) {
        avgCX = connNodes.reduce((a,n) => a + n.x * scaleX, 0) / connNodes.length;
        avgCY = connNodes.reduce((a,n) => a + n.y * scaleY, 0) / connNodes.length;
      }
      // Place tooltip on opposite side from connections
      let tx = avgCX < mx ? mx - tw - 16 : mx + 16;
      let ty = avgCY < my ? my - th - 8 : my + 8;
      // Clamp to viewport
      if (tx + tw > cw - 4) tx = cw - tw - 4;
      if (tx < 4) tx = 4;
      if (ty + th > ch - 4) ty = ch - th - 4;
      if (ty < 4) ty = 4;
      tip.style.left = tx + "px";
      tip.style.top = ty + "px";
    })
    .on("mouseleave", () => {
      setHovered(null);
      if (tipRef.current) tipRef.current.style.display = "none";
    });

    node.on("click", (e, d) => { e.stopPropagation(); if (tipRef.current) tipRef.current.style.display = "none"; onSel(sel === d.t ? null : d.t); });

    node.call(d3.drag()
      .on("start", (e, d) => {
        // Lower alpha reheat (0.1 vs 0.3) so other nodes barely disturb
        if (!e.active) sim.alphaTarget(0.1).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on("end", (e, d) => {
        if (!e.active) sim.alphaTarget(0);
        // Keep node pinned where user dropped it — stops the post-drop drift.
        // Double-click releases (see dblclick handler below).
        // Also auto-release after 4s if user doesn't interact further.
      }));

    // Double-click any node to release its pin and let it float back toward zone
    node.on("dblclick", (e, d) => {
      e.stopPropagation();
      d.fx = null; d.fy = null;
      sim.alphaTarget(0.1).restart();
      setTimeout(() => sim.alphaTarget(0), 600);
    });

    let tickCount = 0;
    sim.on("tick", () => {
      link.attr("d", d => {
        const dx = d.target.x - d.source.x, dy = d.target.y - d.source.y;
        const cx = (d.source.x + d.target.x) / 2 + dy * 0.15;
        const cy = (d.source.y + d.target.y) / 2 - dx * 0.15;
        return `M${d.source.x},${d.source.y} Q${cx},${cy} ${d.target.x},${d.target.y}`;
      });
      edgeLabels.attr("x", d => (d.source.x + d.target.x) / 2)
        .attr("y", d => (d.source.y + d.target.y) / 2 - 3);
      node.attr("transform", d => `translate(${d.x},${d.y})`);
      tickCount++;

    });

    svg.on("click", () => { onSel(null); setZoneHl(null); });
    return () => sim.stop();
  }, [cos, tSet, getColor, liveData, liveFund]);

  // Selection + hover + zone highlight + search highlight
  useEffect(() => {
    if (!ref.current || !gRef.current) return;
    const svg = d3.select(ref.current);
    const g = gRef.current;
    const selCo = COMPANIES.find(c => c.t === sel);
    const hovCo = COMPANIES.find(c => c.t === hovered);
    const active = sel || hovered; // whichever is set
    const activeCo = selCo || hovCo;
    const ac = activeCo ? VX[activeCo.v].c : "#aaa";
    const isClick = !!sel; // stronger effect for clicks
    const sq = (searchQuery || "").toLowerCase();
    const zoneYs = ZONES.map(z => z[1]);

    const isConn = (ticker) => EDGES.some(([s, t]) => (s === active && t === ticker) || (t === active && s === ticker));

    // Edge labels - show for active connections
    svg.selectAll(".edge-label").transition().duration(200)
      .attr("fill", d => {
        if (!d || !d.source) return "transparent";
        const hit = (d.source.t === active || d.target.t === active);
        return hit ? "#666" : "transparent";
      });

    // Edges
    svg.selectAll("path[stroke-dasharray]").transition().duration(200)
      .attr("stroke", d => {
        if (!d || !d.source) return "#c8c8c0";
        if (d.source.t === active || d.target.t === active) return ac;
        if (hovered && !sel && (d.source.t === hovered || d.target.t === hovered)) return ac;
        return "#c8c8c0";
      })
      .attr("stroke-width", d => {
        if (!d || !d.source) return 0.6;
        const hit = (d.source.t === active || d.target.t === active);
        if (hit) return 1.6;
        return active ? 0.3 : 0.6;
      })
      .attr("stroke-opacity", d => {
        if (!d || !d.source) return 0.5;
        const hit = (d.source.t === active || d.target.t === active);
        if (hit) return 0.85;
        return active ? 0.2 : 0.5;
      });

    // Main circles

    svg.selectAll(".main-circle").transition().duration(200)
      .attr("fill", "#fff")
      .attr("fill-opacity", d => {
        const matchesSearch = sq && (d.t.toLowerCase().includes(sq) || d.nm.toLowerCase().includes(sq));
        const inZone = zoneHl === null || (POS[d.t] && Math.abs(POS[d.t][1] - zoneYs[zoneHl]) < 35);
        if (matchesSearch) return 1;
        if (!active && zoneHl === null) return 1;
        if (d.t === active) return 1;
        if (active) return isConn(d.t) ? 1 : 0.15;
        return inZone ? 1 : 0.15;
      })
      .attr("stroke", d => {
        const matchesSearch = sq && (d.t.toLowerCase().includes(sq) || d.nm.toLowerCase().includes(sq));
        if (matchesSearch) return "#111";
        if (d.t === active) return "#222";
        if (active && isConn(d.t)) return getColor(d);
        return getColor(d);
      })
      .attr("stroke-width", d => {
        const matchesSearch = sq && (d.t.toLowerCase().includes(sq) || d.nm.toLowerCase().includes(sq));
        if (matchesSearch) return 2.5;
        if (d.t === active) return 3;
        if (active && isConn(d.t)) return 2;
        return 1.5;
      })
      .attr("filter", d => d.t === active ? "url(#glow)" : "none");

    // Brand circles - dim non-connected
    svg.selectAll(".brand-circle").transition().duration(200)
      .attr("fill-opacity", d => {
        if (!active && zoneHl === null) return 1;
        if (d.t === active) return 1;
        if (active) return isConn(d.t) ? 1 : 0.12;
        const inZone = zoneHl === null || (POS[d.t] && Math.abs(POS[d.t][1] - zoneYs[zoneHl]) < 35);
        return inZone ? 1 : 0.15;
      });
    svg.selectAll(".brand-text").transition().duration(200)
      .attr("fill-opacity", d => {
        if (!active && zoneHl === null) return 1;
        if (d.t === active) return 1;
        if (active) return isConn(d.t) ? 1 : 0.12;
        const inZone = zoneHl === null || (POS[d.t] && Math.abs(POS[d.t][1] - zoneYs[zoneHl]) < 35);
        return inZone ? 1 : 0.15;
      });

    // Profit rings
    svg.selectAll(".profit-ring").transition().duration(200)
      .attr("stroke-opacity", d => {
        if (!active && zoneHl === null) return 0.35;
        if (d.t === active) return 0.7;
        if (active) return isConn(d.t) ? 0.5 : 0.1;
        const inZone = zoneHl === null || (POS[d.t] && Math.abs(POS[d.t][1] - zoneYs[zoneHl]) < 35);
        return inZone ? 0.4 : 0.1;
      });

    // Zone labels
    svg.selectAll(".zone-text").attr("fill", (d, i) => zoneHl === i ? "#333" : "#aaa")
      .attr("font-weight", (d, i) => zoneHl === i ? 700 : 400)
      .attr("font-size", (d, i) => zoneHl === i ? 12 : 10);

    // Zoom: only on click or zone select (NOT hover)
    if (sel && selCo) {
      const allNodes = svg.selectAll(".main-circle").data();
      const conn = new Set([sel]);
      EDGES.forEach(([s, t]) => { if (s === sel) conn.add(t); if (t === sel) conn.add(s); });
      const cluster = allNodes.filter(d => conn.has(d.t) && d.x != null);
      if (cluster.length > 0) {
        const pad = 40;
        const minX = Math.min(...cluster.map(d => d.x - d.r)) - pad;
        const maxX = Math.max(...cluster.map(d => d.x + d.r)) + pad;
        const minY = Math.min(...cluster.map(d => d.y - d.r)) - pad;
        const maxY = Math.max(...cluster.map(d => d.y + d.r)) + pad;
        const scale = Math.min(W / (maxX - minX), H / (maxY - minY), 2.2);
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        const txVal = W/2 - cx*scale, tyVal = H/2 - cy*scale;
        zoomLock.current = true;
        g.transition().duration(600).ease(d3.easeCubicOut)
          .attr("transform", `translate(${txVal},${tyVal}) scale(${scale})`)
          .on("end", () => { zoomLock.current = false; });
      }
    } else if (zoneHl !== null) {
      const zy = zoneYs[zoneHl];
      const zoneNodes = svg.selectAll(".main-circle").data().filter(d => POS[d.t] && Math.abs(POS[d.t][1] - zy) < 30);
      if (zoneNodes.length > 0) {
        const pad = 30;
        const minX = Math.min(...zoneNodes.map(d => d.x - d.r)) - pad;
        const maxX = Math.max(...zoneNodes.map(d => d.x + d.r)) + pad;
        const scale = Math.min(W / (maxX - minX), 2);
        const cx = (minX + maxX) / 2;
        const txVal2 = W/2 - cx*scale, tyVal2 = H/2 - zy*scale;
        zoomLock.current = true;
        g.transition().duration(500).ease(d3.easeCubicOut)
          .attr("transform", `translate(${txVal2},${tyVal2}) scale(${scale})`)
          .on("end", () => { zoomLock.current = false; });
      }
    } else if (!hovered) {
      zoomLock.current = true;
      g.transition().duration(500).ease(d3.easeCubicOut).attr("transform", "")
        .on("end", () => { zoomLock.current = false; });
    }
  }, [sel, hovered, zoneHl, searchQuery, getColor]);

  return (
    <div style={{ position: "relative", background: "#fff", borderRadius: 12, overflow: "hidden", border: "1px solid rgba(0,0,0,.06)", boxShadow: "0 2px 8px rgba(0,0,0,.04)" }}>
      <GraphToolbar colorMode={colorMode} setColorMode={setColorMode} nodesRef={nodesRef} simRef={simRef} />
      <svg ref={ref} width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }} />

      {/* Hover tooltip */}
      <div ref={tipRef} style={{
        display: "none", position: "absolute", background: "#fff", border: "1px solid rgba(0,0,0,.1)",
        borderRadius: 10, padding: "10px 12px", pointerEvents: "none", zIndex: 10,
        boxShadow: "0 6px 20px rgba(0,0,0,.12), 0 2px 6px rgba(0,0,0,.06)",
        maxWidth: 220, minWidth: 160,
      }} />
      {/* Legend */}
      <div style={{ position: "absolute", bottom: 4, left: 8, display: "flex", gap: 5, flexWrap: "wrap" }}>
        {Object.entries(theme?.verticals || AI_VERTICALS).map(([k, v]) => (
          <span key={k} style={{ fontSize: 10, color: !vFilter || vFilter === k ? v.c : "#ccc" }}>
            <span style={{ display: "inline-block", width: 4, height: 4, borderRadius: "50%", background: v.c, marginRight: 2, opacity: !vFilter || vFilter === k ? 1 : 0.2 }} />
            {v.n}
          </span>
        ))}
        {colorMode !== "vertical" && (
          <span style={{ fontSize: 10, color: "#aaa", marginLeft: 4 }}>
            | ring = {"\u{1F7E2}"} profitable {"\u{1F534}"} unprofitable
          </span>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════ COMPS + HEATMAP ════════════════════════ */
function Comps({ cos, sel, onSel }) {
  const [sortKey, setSortKey] = useState("mc");
  const [sortDir, setSortDir] = useState(-1);
  const toggleSort = (key) => { if (sortKey === key) setSortDir(d => d * -1); else { setSortKey(key); setSortDir(-1); } };
  const cols = [
    { k: "t", l: "Ticker", w: null },
    { k: "cc", l: "\u{1F30D}", w: 24 },
    { k: "v", l: "Sector", w: null },
    { k: "mc", l: "Mkt Cap", w: null },
    { k: "r", l: "Revenue", w: null },
    { k: "g", l: "GM%", w: null },
    { k: "pe", l: "P/E", w: null },
    { k: "gr", l: "Growth", w: null },
    { k: "ai", l: "AI Exp", w: null },
  ];
  const getVal = (c, k) => k === "gr" ? (c.fin?.rg?.[4] || 0) : k === "ai" ? (c.ms?.ai || 0) : k === "t" ? c.t : k === "cc" ? (c.cc || "") : c[k] ?? -Infinity;
  const sorted = [...cos].sort((a, b) => {
    const av = getVal(a, sortKey), bv = getVal(b, sortKey);
    if (typeof av === "string") return sortDir * av.localeCompare(bv);
    return sortDir * ((av || 0) - (bv || 0));
  });
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ fontSize: 11, color: "#aaa", marginBottom: 4 }}>{cos.length} companies &middot; sorted by {cols.find(c => c.k === sortKey)?.l}</div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, background: "#fff", borderRadius: 8 }}>
        <thead><tr>
          {cols.map(col => (
            <th key={col.k} onClick={() => toggleSort(col.k)} style={{ textAlign: "left", padding: "4px 4px", borderBottom: "1px solid rgba(0,0,0,.08)", color: sortKey === col.k ? "#333" : "#aaa", fontSize: 10, textTransform: "uppercase", letterSpacing: 1, cursor: "pointer", whiteSpace: "nowrap", width: col.w || "auto" }}>
              {col.l}{sortKey === col.k ? (sortDir > 0 ? " \u25B2" : " \u25BC") : ""}
            </th>
          ))}
        </tr></thead>
        <tbody>{sorted.map(c => {
          const vc = VX[c.v];
          const gr = c.fin?.rg?.[4] || 0;
          return (
            <tr key={c.t} onClick={() => onSel(c.t)} style={{ cursor: "pointer", background: c.t === sel ? "rgba(0,0,0,.05)" : "transparent", borderBottom: "1px solid rgba(0,0,0,.02)", transition: "background 0.1s" }}
              onMouseEnter={e => { if (c.t !== sel) e.currentTarget.style.background = "rgba(0,0,0,.025)"; }}
              onMouseLeave={e => { if (c.t !== sel) e.currentTarget.style.background = "transparent"; }}>
              <td style={{ padding: "3px 4px", color: c.t === sel ? vc.c : "#333", fontWeight: 700 }}><Logo ticker={c.t} size={14} style={{ marginRight: 4 }} />${c.t}</td>
              <td style={{ padding: "3px 2px", fontSize: 11 }}>{c.cc}</td>
              <td style={{ padding: "3px 4px" }}><span style={{ fontSize: 10, color: vc.c, background: vc.bg, padding: "1px 4px", borderRadius: 3 }}>{vc.n}</span></td>
              <td style={{ padding: "3px 4px", color: "#444" }}>{fmtMC(c.mc)}</td>
              <td style={{ padding: "3px 4px", color: "#444" }}>{fmtMC(c.r)}</td>
              <td style={{ padding: "3px 4px", color: "#555" }}>{c.g}%</td>
              <td style={{ padding: "3px 4px", color: "#555" }}>{c.pe ? c.pe + "x" : "\u2014"}</td>
              <td style={{ padding: "3px 4px", color: gr > 30 ? "#1a8a5c" : gr < 0 ? "#c44040" : "#555" }}>{gr > 0 ? "+" : ""}{gr}%</td>
              <td style={{ padding: "3px 4px", color: "#555" }}>{(c.ms?.ai * 100 || 0).toFixed(0)}%</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

function Heatmap({ cos, sel, onSel, onFilterVertical, theme }) {
  const macroAxes = theme?.macro || AI_MACRO;
  const macroKeys = macroAxes.map(m => m.k);
  const macroNames = Object.fromEntries(macroAxes.map(m => [m.k, m.n]));
  const themeVerticals = theme?.verticals || AI_VERTICALS;

  // By-vertical summary
  const vertSummary = Object.entries(themeVerticals).map(([k, v]) => {
    const vcos = cos.filter(c => resolveCompanyVertical(c, theme) === k);
    const n = vcos.length || 1;
    const avgs = {};
    macroKeys.forEach(mk => { avgs[mk] = Math.round(vcos.reduce((a, c) => a + (c.ms?.[mk] || 0), 0) / n * 100); });
    return { k, name: v.n, color: v.c, count: vcos.length, ...avgs };
  }).filter(v => v.count > 0);

  // Most exposed companies per macro factor
  const topExposed = macroKeys.map(mk => {
    const top = [...cos].sort((a, b) => (b.ms?.[mk] || 0) - (a.ms?.[mk] || 0)).slice(0, 5);
    return { mk, name: macroNames[mk], companies: top };
  });

  const cellBg = (val) => val > 70 ? `rgba(196,64,64,${val / 180})` : val > 40 ? `rgba(184,134,11,${val / 220})` : `rgba(26,138,92,${val / 280})`;

  return (
    <div>
      {/* Vertical-level heatmap */}
      <div style={{ fontSize: 11, fontWeight: 600, color: "#999", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 5 }}>
        Macro sensitivity by vertical
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "110px repeat(" + macroKeys.length + ", 1fr)", gap: 2, marginBottom: 16 }}>
        <div />
        {macroKeys.map(mk => <div key={mk} style={{ padding: "3px 0", textAlign: "center", fontSize: 10, color: "#999", fontWeight: 600, textTransform: "uppercase" }}>{macroNames[mk]}</div>)}
        {vertSummary.map(v => [
          <div key={v.k + "n"} style={{ padding: "3px 4px", fontSize: 11, color: v.color, fontWeight: 600, display: "flex", alignItems: "center" }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: v.color, marginRight: 4, flexShrink: 0 }} />
            {v.name} <span style={{ color: "#bbb", marginLeft: 3, fontWeight: 400 }}>({v.count})</span>
          </div>,
          ...macroKeys.map(mk => (
            <div key={v.k + mk} style={{ background: cellBg(v[mk]), borderRadius: 3, padding: "3px 0", textAlign: "center", fontSize: 10, color: v[mk] > 50 ? "#fff" : "#444", fontWeight: 600 }}>
              {v[mk]}
            </div>
          )),
        ])}
      </div>

      {/* Most exposed companies per factor */}
      <div style={{ fontSize: 11, fontWeight: 600, color: "#999", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 5 }}>
        Most exposed companies
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(" + Math.min(4, macroKeys.length) + ", 1fr)", gap: 8 }}>
        {topExposed.map(({ mk, name, companies }) => (
          <div key={mk} style={{ background: "#fff", border: "1px solid rgba(0,0,0,.05)", borderRadius: 8, padding: 7 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#999", marginBottom: 4 }}>{name}</div>
            {companies.map(c => {
              const vc = VX[c.v] || { c: "#888" };
              const val = Math.round((c.ms?.[mk] || 0) * 100);
              return (
                <div key={c.t} onClick={() => onSel(c.t)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 0", cursor: "pointer", borderBottom: "1px solid rgba(0,0,0,.02)" }}>
                  <Logo ticker={c.t} size={11} style={{ marginRight: 2 }} /><span style={{ fontSize: 11, fontWeight: 600, color: c.t === sel ? vc.c : "#555" }}>{c.cc} ${c.t}</span>
                  <span style={{ fontSize: 11, color: val > 70 ? "#c44040" : val > 40 ? "#b8860b" : "#1a8a5c", fontWeight: 600 }}>{val}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════ MAIN APP ════════════════════════ */
/* ═════════════════ DASHBOARD SUB-COMPONENTS ═════════════════ */
// Extracted from PhotonicsObservatory for readability.

function ThemeSwitcher({ themeId, setThemeId }) {
  return (
    <div style={{ position: "relative", marginBottom: 14, paddingBottom: 10, borderBottom: "1px solid rgba(0,0,0,.05)" }}>
      <div style={{ fontSize: 9, color: "#bbb", letterSpacing: 2, textTransform: "uppercase", fontWeight: 600, marginBottom: 6 }}>
        Investment Thesis
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {THEME_ORDER.map(tid => {
          const t = THEMES[tid];
          const active = tid === themeId;
          const unavailable = !t.available;
          return (
            <button key={tid}
              onClick={() => { if (t.available) setThemeId(tid); }}
              disabled={unavailable}
              title={unavailable ? "Coming soon" : t.subtitle}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                background: active ? "#fff" : unavailable ? "rgba(0,0,0,.015)" : t.meta ? "rgba(85,107,47,.04)" : "transparent",
                border: active ? `1px solid ${t.accent}66` : t.meta ? "1px dashed rgba(0,0,0,.08)" : "1px solid transparent",
                borderRadius: 7, padding: "4px 10px",
                fontSize: 11, color: active ? t.accent : unavailable ? "#ccc" : "#666",
                cursor: unavailable ? "not-allowed" : "pointer", fontWeight: active ? 700 : 500,
                boxShadow: active ? `0 1px 4px ${t.accent}22` : "none",
                transition: "all 0.12s ease", letterSpacing: 0.2,
                opacity: unavailable ? 0.6 : 1,
              }}>
              <span style={{ fontSize: 11, color: active ? t.accent : unavailable ? "#ddd" : "#aaa" }}>{t.icon}</span>
              <span>{t.title.replace(/^The /, "")}</span>
              {unavailable && <span style={{ fontSize: 8, color: "#bbb", fontWeight: 600, marginLeft: 2 }}>soon</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SettingsPanel({ refreshData, dataStatus, liveData, researchStatus }) {
  return (
    <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 10, padding: 12, marginBottom: 10, animation: "fadeIn 0.2s ease", boxShadow: "0 2px 8px rgba(0,0,0,.04)" }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#999", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 8 }}>Platform Wiring</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 10, color: "#999", textTransform: "uppercase", letterSpacing: 1 }}>Market data</div>
          <div style={{ fontSize: 11, color: dataStatus === "live" ? "#1a8a5c" : dataStatus === "loading" ? "#b8860b" : "#888", marginTop: 2 }}>
            {dataStatus === "live"
              ? `Connected via platform API for ${Object.keys(liveData).length} tickers`
              : dataStatus === "loading"
                ? "Refreshing platform market data…"
                : "No live quote snapshot loaded"}
          </div>
        </div>
        <button onClick={refreshData} disabled={dataStatus === "loading"} style={{
          background: dataStatus === "loading" ? "rgba(0,0,0,.04)" : "#1a8a5c", border: "none", borderRadius: 5,
          padding: "5px 10px", fontSize: 11, fontWeight: 700, cursor: dataStatus === "loading" ? "default" : "pointer",
          color: dataStatus === "loading" ? "#aaa" : "#fff",
        }}>{dataStatus === "loading" ? "Fetching..." : "Refresh"}</button>
      </div>
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 10, color: "#999", textTransform: "uppercase", letterSpacing: 1 }}>Research provider</div>
        <div style={{ fontSize: 11, color: researchStatus?.configured ? "#1a8a5c" : "#888", marginTop: 2, lineHeight: 1.5 }}>
          {researchStatus?.configured
            ? `Connected server-side (${String(researchStatus.provider || "research").toUpperCase()}) for fundamentals, calendar, filings, and transcripts`
            : "Offline. Add an FMP secret on the server to enable fundamentals, calendar, filings, and transcript research panels."}
        </div>
      </div>
      {dataStatus === "live" && <div style={{ fontSize: 11, color: "#1a8a5c", marginTop: 3 }}>✓ Live data for {Object.keys(liveData).length} tickers</div>}
    </div>
  );
}

export default function PhotonicsObservatory({ onJumpToTrade }) {
  const [themeId, setThemeId] = useState("ai");
  const [sel, setSel] = useState(null);
  const [vf, setVf] = useState(null);
  const [sf, setSf] = useState(null);
  const [view, setView] = useState("graph");
  const [q, setQ] = useState("");
  const apiKey = "__platform__";
  const [liveData, setLiveData] = useState({});
  const [liveFund, setLiveFund] = useState({}); // {[ticker]: {revenueTTM, grossMarginTTM, beta, ...}} — populated by background prefetch
  const [liveHist, setLiveHist] = useState({}); // {[ticker]: [{price, fullDate, ...}, ...]} — 1-hour bars ~30 days, populated by backgroundPrefetchHist
  const [dataStatus, setDataStatus] = useState("static");
  const [prefetchProgress, setPrefetchProgress] = useState({ done: 0, total: 0, active: false });
  const [histPrefetchProgress, setHistPrefetchProgress] = useState({ done: 0, total: 0, active: false });
  const [researchStatus, setResearchStatus] = useState({ configured: false, provider: null });
  const [showSettings, setShowSettings] = useState(false);
  const graphRef = useRef();
  const detailRef = useRef();

  const currentTheme = THEMES[themeId] || THEMES.ai;

  // Reset per-theme state when switching themes
  useEffect(() => {
    setVf(null);
    setSf(null);
    setSel(null);
    setQ("");
  }, [themeId]);

  // Auto-scroll to detail on select, back to graph on deselect
  const prevSel = useRef(null);
  useEffect(() => {
    if (sel && !prevSel.current && detailRef.current) {
      setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 350);
    }
    if (!sel && prevSel.current && graphRef.current) {
      setTimeout(() => graphRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    }
    prevSel.current = sel;
  }, [sel]);

  useEffect(() => {
    fetchResearchStatus().then(status => {
      setResearchStatus(status || { configured: false, provider: null });
    });
  }, []);

  // Active-theme universe: only companies tagged with the current theme
  const themeUniverse = useMemo(() => COMPANIES.filter(c => themeMatchesCompany(themeId, c)), [themeId]);

  const cos = useMemo(() => {
    let list = themeUniverse;
    if (vf) list = list.filter(c => resolveCompanyVertical(c, currentTheme) === vf);
    if (sf) list = list.filter(c => c.s === sf);
    if (q) {
      const s = q.toLowerCase();
      list = list.filter(c => c.t.toLowerCase().includes(s) || c.nm.toLowerCase().includes(s));
    }
    // Include directly connected nodes from other verticals to preserve edges
    if (vf || sf || q) {
      const tickers = new Set(list.map(c => c.t));
      const neighbors = new Set();
      EDGES.forEach(([s, t]) => {
        if (tickers.has(s) && !tickers.has(t)) neighbors.add(t);
        if (tickers.has(t) && !tickers.has(s)) neighbors.add(s);
      });
      const neighborCos = themeUniverse.filter(c => neighbors.has(c.t) && !tickers.has(c.t));
      list = [...list, ...neighborCos];
    }
    return list;
  }, [themeUniverse, vf, sf, q]);

  // Clear orphaned selection when filters exclude the selected company
  useEffect(() => {
    if (sel && vf && !cos.find(c => c.t === sel)) setSel(null);
  }, [vf, sf, cos]);

  const refreshData = async () => {
    setDataStatus("loading");
    try {
      const tickers = COMPANIES.map(c => c.t);
      const quotes = await fetchQuotes(tickers);
      setLiveData(quotes);
      setDataStatus(Object.keys(quotes).length > 0 ? "live" : "error");
      setPrefetchProgress({ done: 0, total: 0, active: false });
      setHistPrefetchProgress({ done: 0, total: 0, active: false });
    } catch(e) { setDataStatus("error"); }
  };
  const didRefresh = useRef(false);
  useEffect(() => { if (apiKey && !didRefresh.current) { didRefresh.current = true; refreshData(); } }, []);

  const selCo = COMPANIES.find(c => c.t === sel);
  const subs = vf ? (currentTheme.verticals[vf]?.subs || []) : [];

  return (
    <div className="photonics-research-root" style={{ background: "#ffffff", height: "100%", minHeight: 0, overflowY: "auto", color: "#222", backgroundImage: "radial-gradient(circle at 20% 50%, rgba(205,162,78,.02) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(94,148,232,.015) 0%, transparent 50%)" }}>
      <style>{`
        .photonics-research-root, .photonics-research-root * { box-sizing: border-box; margin: 0; padding: 0; }
        .photonics-research-root { font-family: Arial, Helvetica, sans-serif; }
        .photonics-research-root button,
        .photonics-research-root input,
        .photonics-research-root textarea,
        .photonics-research-root select,
        .photonics-research-root table,
        .photonics-research-root div,
        .photonics-research-root span,
        .photonics-research-root p,
        .photonics-research-root h2,
        .photonics-research-root h3,
        .photonics-research-root h4,
        .photonics-research-root h5,
        .photonics-research-root h6 { font-family: inherit; }
        .photonics-research-root ::-webkit-scrollbar { width: 4px; height: 4px; }
        .photonics-research-root ::-webkit-scrollbar-track { background: transparent; }
        .photonics-research-root ::-webkit-scrollbar-thumb { background: rgba(205,162,78,.15); border-radius: 4px; }
        .photonics-research-root ::-webkit-scrollbar-thumb:hover { background: rgba(205,162,78,.3); }
        .photonics-research-root input[type=range] { -webkit-appearance: none; background: rgba(0,0,0,.06); border-radius: 3px; height: 3px; }
        .photonics-research-root input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #fff; cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,.15); border: 2px solid rgba(205,162,78,.4); }
        .photonics-research-root input[type=range]::-webkit-slider-thumb:hover { border-color: rgba(205,162,78,.8); }
        .photonics-research-root button { transition: all 0.12s ease; }
        .photonics-research-root button:active { transform: scale(0.97); }
        .photonics-research-root ::selection { background: rgba(205,162,78,.15); color: #111; }
        @keyframes slideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes edgeFlow { to { stroke-dashoffset: -12; } }
        @keyframes shimmer { from { background-position: -200px 0; } to { background-position: 200px 0; } }
        @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.85); } }
      `}</style>

      {/* Header */}
      <div style={{ padding: "20px 20px 0", position: "relative" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 200, background: `radial-gradient(ellipse at 30% -30%, ${currentTheme.accent}14 0%, transparent 55%), radial-gradient(ellipse at 90% 20%, rgba(94,148,232,.03) 0%, transparent 40%)`, pointerEvents: "none" }} />

        <ThemeSwitcher themeId={themeId} setThemeId={setThemeId} />

        <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: currentTheme.accent, letterSpacing: 5, textTransform: "uppercase", fontWeight: 600 }}>
              {currentTheme.subtitle}
            </div>
            <h1 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 34, fontWeight: 400, color: "#111", letterSpacing: -1, lineHeight: 1.05, marginTop: 3 }}>
              {currentTheme.title}
            </h1>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: currentTheme.accent }}>
              {fmtMC(themeUniverse.reduce((a, c) => a + c.mc, 0))}
            </div>
            <div style={{ fontSize: 11, color: "#aaa" }}>
              {themeUniverse.length} cos / {EDGES.filter(e => themeUniverse.find(c => c.t === e[0]) && themeUniverse.find(c => c.t === e[1])).length} links
              <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, fontWeight: 600, marginLeft: 4,
                background: dataStatus === "live" ? "rgba(26,138,92,.1)" : dataStatus === "loading" ? "rgba(184,134,11,.1)" : "rgba(0,0,0,.04)",
                color: dataStatus === "live" ? "#1a8a5c" : dataStatus === "loading" ? "#b8860b" : "#aaa",
              }}>{dataStatus === "live" ? "\u25CF LIVE" : dataStatus === "loading" ? "LOADING..." : "STATIC"}</span>
              {prefetchProgress.total > 0 && (
                <span
                  title={prefetchProgress.active
                    ? `Prefetching TTM fundamentals: ${prefetchProgress.done}/${prefetchProgress.total} done`
                    : `Fundamentals prefetch complete: ${prefetchProgress.done} companies refreshed`}
                  style={{
                    fontSize: 10, padding: "1px 5px", borderRadius: 3, fontWeight: 600, marginLeft: 4,
                    background: prefetchProgress.active ? "rgba(94,148,232,.12)" : "rgba(26,138,92,.08)",
                    color: prefetchProgress.active ? "#5e94e8" : "#1a8a5c",
                }}>
                  {prefetchProgress.active
                    ? `\u29BF ${prefetchProgress.done}/${prefetchProgress.total}`
                    : `\u2713 ${prefetchProgress.done} TTM`}
                </span>
              )}
              {histPrefetchProgress.total > 0 && (
                <span
                  title={histPrefetchProgress.active
                    ? `Prefetching intraday 1-hour bars: ${histPrefetchProgress.done}/${histPrefetchProgress.total} done`
                    : `Intraday history prefetch complete: ${histPrefetchProgress.done} companies with 1H bars cached`}
                  style={{
                    fontSize: 10, padding: "1px 5px", borderRadius: 3, fontWeight: 600, marginLeft: 4,
                    background: histPrefetchProgress.active ? "rgba(142,68,173,.12)" : "rgba(26,138,92,.08)",
                    color: histPrefetchProgress.active ? "#8e44ad" : "#1a8a5c",
                }}>
                  {histPrefetchProgress.active
                    ? `\u29BF ${histPrefetchProgress.done}/${histPrefetchProgress.total} 1H`
                    : `\u2713 ${histPrefetchProgress.done} 1H`}
                </span>
              )}
              <button onClick={() => setShowSettings(s => !s)} style={{ background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 5, padding: "1px 6px", fontSize: 11, cursor: "pointer", color: "#888", marginLeft: 2 }}>\u2699</button>
            </div>
          </div>
        </div>

        {showSettings && (
          <SettingsPanel refreshData={refreshData} dataStatus={dataStatus} liveData={liveData} researchStatus={researchStatus} />
        )}

        <div style={{ position: "relative", marginBottom: 8 }}>
          <input type="text" value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && cos.length === 1) { setSel(cos[0].t); setQ(""); } if (e.key === "Escape") { setQ(""); setSel(null); } }}
            placeholder="Search ticker or company..."
            style={{ width: "100%", background: "#fff", border: "1px solid rgba(0,0,0,.08)", borderRadius: 8, padding: "8px 14px", color: "#333", fontSize: 11, outline: "none", boxShadow: "0 1px 3px rgba(0,0,0,.04)" }}
          />
          {q && <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: "#aaa" }}>{cos.length} match{cos.length !== 1 ? "es" : ""}</span>
            <button onClick={() => setQ("")} style={{ background: "rgba(0,0,0,.06)", border: "none", borderRadius: "50%", width: 16, height: 16, cursor: "pointer", color: "#888", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", padding: 0, lineHeight: 1 }}>✕</button>
          </span>}
        </div>

        {/* Vertical filter pills */}
        <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginBottom: 4 }}>
          <button onClick={() => { setVf(null); setSf(null); }} style={{ background: !vf ? "#fff" : "transparent", border: !vf ? "1px solid rgba(0,0,0,.1)" : "1px solid transparent", borderRadius: 6, padding: "4px 10px", fontSize: 11, color: !vf ? "#111" : "#888", cursor: "pointer", fontWeight: 600, boxShadow: !vf ? "0 1px 3px rgba(0,0,0,.06)" : "none" }}>ALL</button>
          {Object.entries(currentTheme.verticals).map(([k, v]) => (
            <button key={k} onClick={() => { setVf(vf === k ? null : k); setSf(null); }} style={{ background: vf === k ? "#fff" : "transparent", border: vf === k ? `1px solid ${v.c}44` : "1px solid transparent", borderRadius: 6, padding: "4px 10px", fontSize: 11, boxShadow: vf === k ? `0 1px 4px ${v.c}18` : "none", color: vf === k ? v.c : "#444", cursor: "pointer", fontWeight: 600, transition: "all 0.15s" }}>
              {v.n}
            </button>
          ))}
        </div>

        {/* Sub-layer pills */}
        {subs.length > 0 && (
          <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginBottom: 4, animation: "fadeIn 0.2s ease" }}>
            <button onClick={() => setSf(null)} style={{ background: !sf ? "rgba(0,0,0,.06)" : "rgba(0,0,0,.03)", border: "none", borderRadius: 4, padding: "3px 7px", fontSize: 10, color: !sf ? "#aaa" : "#333", cursor: "pointer" }}>All layers</button>
            {subs.map(s => (
              <button key={s} onClick={() => setSf(sf === s ? null : s)} style={{ background: sf === s ? currentTheme.verticals[vf]?.bg : "rgba(0,0,0,.03)", border: sf === s ? `1px solid ${currentTheme.verticals[vf]?.c}22` : "1px solid transparent", borderRadius: 4, padding: "3px 7px", fontSize: 10, color: sf === s ? currentTheme.verticals[vf]?.c : "#444", cursor: "pointer" }}>
                {s}
              </button>
            ))}
          </div>
        )}

        {/* View tabs */}
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid rgba(0,0,0,.06)", marginTop: 8 }}>
          {[["graph", "Graph"], ["comps", "Comps"], ["macro", "Macro"], ["calendar", "📅 Calendar"]].map(([id, lb]) => (
            <button key={id} onClick={() => setView(id)} style={{ background: "none", border: "none", borderBottom: view === id ? "2px solid #CDA24E" : "2px solid transparent", padding: "8px 16px", color: view === id ? "#111" : "#999", fontSize: 10, fontWeight: view === id ? 700 : 500, cursor: "pointer", letterSpacing: 0.3 }}>
              {lb}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "14px 20px 80px" }}>
        {view === "calendar" ? (
          <CalendarView
            cos={COMPANIES}
            liveData={liveData}
            apiKey={apiKey}
            themes={THEMES}
            onSelect={(ticker) => {
              // Switch to a theme containing this company, then set selection + switch view to graph
              const co = COMPANIES.find(c => c.t === ticker);
              if (co && co.themes && co.themes.length) {
                // Prefer a theme that's in the curated switcher, else any available theme
                const visibleTheme = co.themes.find(tid => THEME_ORDER.includes(tid) && THEMES[tid]?.available);
                const availableTheme = visibleTheme || co.themes.find(tid => THEMES[tid]?.available) || co.themes[0];
                setThemeId(availableTheme);
              }
              setSel(ticker);
              setView("graph");
            }}
          />
        ) : themeUniverse.length === 0 ? (
          <div style={{ animation: "fadeIn 0.3s ease", maxWidth: 560, margin: "60px auto", textAlign: "center" }}>
            <div style={{ fontSize: 48, color: currentTheme.accent, marginBottom: 12, opacity: 0.4 }}>{currentTheme.icon}</div>
            <h2 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 26, fontWeight: 400, color: "#222", marginBottom: 8, letterSpacing: -0.5 }}>
              {currentTheme.title}
            </h2>
            <div style={{ fontSize: 12, color: "#888", lineHeight: 1.6, marginBottom: 18 }}>
              {currentTheme.subtitle}
            </div>
            <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,.06)", borderRadius: 10, padding: "16px 20px", boxShadow: "0 1px 3px rgba(0,0,0,.03)", display: "inline-block" }}>
              <div style={{ fontSize: 10, color: currentTheme.accent, letterSpacing: 2, textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>Coming Soon</div>
              <div style={{ fontSize: 12, color: "#555", lineHeight: 1.5, maxWidth: 400 }}>
                This thesis is under construction. The universe, supply chain relationships, value stream, and macro exposure panels are being curated. Company coverage will land in an upcoming release.
              </div>
              <div style={{ marginTop: 12, display: "flex", gap: 4, justifyContent: "center", flexWrap: "wrap" }}>
                {(currentTheme.macro || []).map(m => (
                  <span key={m.k} style={{ fontSize: 10, color: "#888", background: "rgba(0,0,0,.03)", padding: "2px 8px", borderRadius: 10 }}>
                    {m.n}
                  </span>
                ))}
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <button onClick={() => setThemeId("ai")} style={{
                background: "#fff", border: "1px solid rgba(0,0,0,.1)", borderRadius: 8,
                padding: "6px 18px", fontSize: 11, color: "#666", cursor: "pointer", fontWeight: 600,
              }}>← Back to AI Trade</button>
            </div>
          </div>
        ) : (<>
        {view === "graph" && (
          <div style={{ animation: "fadeIn 0.3s ease" }}>
            <div ref={graphRef}><Graph cos={cos} sel={sel} onSel={setSel} vFilter={vf} searchQuery={q} theme={currentTheme} liveData={liveData} liveFund={liveFund} /></div>
            {selCo ? (
              <div ref={detailRef}>
                {/* Selected company indicator bar */}
                <div style={{
                  marginTop: 10, marginBottom: 8, padding: "7px 12px",
                  background: "#fff", borderRadius: 10, border: "1px solid rgba(0,0,0,.06)",
                  boxShadow: "0 2px 8px rgba(0,0,0,.04)",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  animation: "fadeIn 0.2s ease",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Logo ticker={selCo.t} size={20} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: VX[selCo.v].c }}>{selCo.cc} {selCo.t}</span>
                    <span style={{ fontSize: 11, color: "#888" }}>{selCo.nm}</span>
                    <span style={{ fontSize: 11, color: "#aaa" }}>&middot; {VX[selCo.v].n}</span>
                  </div>
                  <button onClick={() => setSel(null)} style={{
                    background: "#fff", border: "1px solid rgba(0,0,0,.08)", borderRadius: 5,
                    padding: "3px 8px", fontSize: 11, color: "#888", cursor: "pointer",
                  }}>✕ Close</button>
                </div>
                <Detail co={selCo} onClose={() => setSel(null)} onSelect={setSel} liveData={liveData} liveHist={liveHist} apiKey={apiKey} onJumpToTrade={onJumpToTrade} />
              </div>
            ) : (
              <MarketSummary onFilterVertical={setVf} onSelect={setSel} theme={currentTheme} liveData={liveData} liveFund={liveFund} />
            )}
          </div>
        )}

        {view === "comps" && (
          <div style={{ animation: "fadeIn 0.3s ease" }}>
            <Comps cos={cos} sel={sel} onSel={setSel} />
            {selCo && <div ref={detailRef} style={{ marginTop: 12 }}><Detail co={selCo} onClose={() => setSel(null)} onSelect={setSel} liveData={liveData} liveHist={liveHist} apiKey={apiKey} onJumpToTrade={onJumpToTrade} /></div>}
          </div>
        )}

        {view === "macro" && (
          <div style={{ animation: "fadeIn 0.3s ease" }}>
            <Heatmap cos={cos} sel={sel} onSel={setSel} onFilterVertical={setVf} theme={currentTheme} />
            {selCo && <div ref={detailRef} style={{ marginTop: 12 }}><Detail co={selCo} onClose={() => setSel(null)} onSelect={setSel} liveData={liveData} liveHist={liveHist} apiKey={apiKey} onJumpToTrade={onJumpToTrade} /></div>}
          </div>
        )}
        </>)}
      </div>
    </div>
  );
}
