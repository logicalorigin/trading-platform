import { AI_VERTICALS } from "./researchSymbols.js";
import {
  AI_MACRO,
  AI_POSITIONS,
  AI_SANKEY_STAGES,
  AI_ZONE_LABELS,
  BATTERIES_SANKEY_STAGES,
  BIOTECH_SANKEY_STAGES,
  CRYPTO_SANKEY_STAGES,
  DEFENSE_SANKEY_STAGES,
  DRONES_SANKEY_STAGES,
  NUCLEAR_SANKEY_STAGES,
  QUANTUM_SANKEY_STAGES,
  ROBOTICS_SANKEY_STAGES,
  SPACE_SANKEY_STAGES,
  URANIUM_SANKEY_STAGES,
} from "./researchGraph.js";

export const THEMES = {
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

export const THEME_ORDER = ["ai", "aerospace_defense", "nuclear", "space", "robotics", "quantum"];
export const META_THEME_IDS = new Set(["aerospace_defense", "physical_ai", "ai_stack", "energy_transition"]);

// Resolver: returns which vertical a company belongs to under a given theme.
// For meta-themes uses the theme's verticalMapper; for regular themes returns co.v.
export function resolveCompanyVertical(co, theme) {
  if (theme && theme.meta && typeof theme.verticalMapper === "function") {
    try { return theme.verticalMapper(co); } catch { return co.v; }
  }
  return co.v;
}

// Company filter: for meta-themes, match ANY constituent theme. For regular themes, match the id.
export function themeMatchesCompany(themeOrId, co) {
  const theme = typeof themeOrId === "string" ? THEMES[themeOrId] : themeOrId;
  if (!theme || !co.themes) return false;
  if (theme.meta && theme.constituentThemes) {
    return co.themes.some(t => theme.constituentThemes.includes(t));
  }
  return co.themes.includes(theme.id);
}

export const VX = new Proxy({}, {
  get(target, prop) {
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
      const verticals = THEMES[tid]?.verticals;
      if (verticals) Object.keys(verticals).forEach((key) => keys.add(key));
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

export const MACRO = AI_MACRO;
