export const AI_VERTICALS = {
  photonics:   { n: "Photonics",       c: "#CDA24E", bg: "rgba(205,162,78,.07)", subs: ["Substrates","Lasers","Foundry","Assembly","DSP","CPO","Transport","Test"] },
  compute:     { n: "AI Compute",      c: "#5E94E8", bg: "rgba(94,148,232,.07)", subs: ["GPU","Custom ASIC","Foundry","IP","Packaging","Systems"] },
  memory:      { n: "HBM & Memory",    c: "#D86890", bg: "rgba(216,104,144,.07)", subs: ["HBM"] },
  power:       { n: "Power & Cooling", c: "#2a9a70", bg: "rgba(72,200,156,.07)", subs: ["Thermal","Power","Generation"] },
  networking:  { n: "Network Fabric",  c: "#A070E8", bg: "rgba(160,112,232,.07)", subs: ["Switching","Interconnect"] },
  dcInfra:     { n: "DC Infra",        c: "#50B8D8", bg: "rgba(80,184,216,.07)", subs: ["REIT","GPU Cloud","AI Hosting"] },
  hyperscaler: { n: "Hyperscalers",    c: "#E06848", bg: "rgba(224,104,72,.07)", subs: ["Cloud","AI Infra"] },
};

// Branded ticker → (color, 2-letter initial) for node iconography.
export const BRAND = {
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
export const FMP_SYM = {
  IQE: "IQE.L",        // London AIM (IQE plc)
  SOI: "SOI.PA",       // Euronext Paris (Soitec)
  SIVE: "SIVE.ST",     // Nasdaq Stockholm (Sivers)
  SKHYNIX: "000660.KS",// KRX Seoul (SK Hynix)
  SAMSUNG: "005930.KS",// KRX Seoul (Samsung Electronics)
};
export const FMP_REVERSE = Object.fromEntries(Object.entries(FMP_SYM).map(([k, v]) => [v, k]));

/* ────── Universe: 276 companies across 11 themes ────── */
