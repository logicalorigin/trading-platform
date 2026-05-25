export const EDGES = [
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
export const AI_POSITIONS = {
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

export const AI_ZONE_LABELS = [
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
export const AI_SANKEY_STAGES = [
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

export const DEFENSE_SANKEY_STAGES = [
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

export const NUCLEAR_SANKEY_STAGES = [
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

export const DRONES_SANKEY_STAGES = [
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

export const SPACE_SANKEY_STAGES = [
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

export const ROBOTICS_SANKEY_STAGES = [
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

export const QUANTUM_SANKEY_STAGES = [
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

export const BIOTECH_SANKEY_STAGES = [
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

export const BATTERIES_SANKEY_STAGES = [
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

export const URANIUM_SANKEY_STAGES = [
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

export const CRYPTO_SANKEY_STAGES = [
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
export const AI_MACRO = [
  { k: "ta", n: "Tariffs" },
  { k: "ch", n: "China" },
  { k: "ai", n: "AI Capex" },
  { k: "ra", n: "Rates" },
];

