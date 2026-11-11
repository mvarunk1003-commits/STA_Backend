/**
 * build-location-data.js
 * 
 * Processes sub_districts.csv (if present) OR falls back to the built-in
 * comprehensive South India dataset for Karnataka, Tamil Nadu, Kerala,
 * Andhra Pradesh, and Telangana.
 * 
 * Outputs: frontend/data/south_india_locations.json
 * 
 * CSV format expected: StateName, DistrictName, SubDistrictName
 * Run: node build-location-data.js
 */

const fs = require('fs');
const path = require('path');

const STATE_FILTER = ['Karnataka', 'Tamil Nadu', 'Kerala', 'Andhra Pradesh', 'Telangana'];

// ============================================================
// BUILT-IN COMPREHENSIVE DATA (used when no CSV is supplied)
// Source: Census of India 2011 Sub-districts
// ============================================================
const BUILT_IN_DATA = {
  "Karnataka": {
    "Bagalkot": ["Badami","Bagalkot","Bilagi","Guledgudda","Hungund","Ilkal","Jamkhandi","Lokapur","Mudhol","Rabkavi Banhatti"],
    "Ballari": ["Ballari","Hadagali","Hospet","Kampli","Kudligi","Sandur","Siraguppa"],
    "Belagavi": ["Athani","Bailhongal","Belagavi","Chikkodi","Gokak","Hukkeri","Kittur","Nippani","Parasgad","Ramdurg","Raybag","Saundatti"],
    "Bengaluru Rural": ["Devanahalli","Doddaballapur","Hoskote","Nelamangala"],
    "Bengaluru Urban": ["Anekal","Bengaluru East","Bengaluru North","Bengaluru South","Kengeri","Uttara Kannada"],
    "Bidar": ["Basavakalyan","Bhalki","Bidar","Humnabad","Chitguppa","Aurad"],
    "Chamarajanagar": ["Chamarajanagar","Gundlupet","Kollegal","Yelandur"],
    "Chikkaballapur": ["Bagepalli","Chikkaballapur","Chintamani","Gauribidanur","Gudibanda","Sidlaghatta"],
    "Chikkamagaluru": ["Chikkamagaluru","Kadur","Koppa","Mudigere","NR Pura","Sringeri","Tarikere"],
    "Chitradurga": ["Challakere","Chitradurga","Hiriyur","Holalkere","Hosadurga","Molakalmuru"],
    "Dakshina Kannada": ["Bantwal","Belthangady","Kadaba","Mangaluru","Puttur","Sullia","Ullal"],
    "Davangere": ["Channagiri","Davangere","Harapanahalli","Harihar","Honnali","Jagalur"],
    "Dharwad": ["Dharwad","Hubli","Kalghatgi","Kundgol","Navalgund"],
    "Gadag": ["Gadag","Mundargi","Naragund","Ron","Shirahatti"],
    "Hassan": ["Alur","Arakalagudu","Arsikere","Belur","Channarayapatna","Hassan","Holenarasipura","Sakleshpur"],
    "Haveri": ["Byadagi","Hangal","Haveri","Hirekerur","Ranebennur","Savanur","Shiggaon"],
    "Kalaburagi": ["Afzalpur","Aland","Chincholi","Chittapur","Gulbarga","Jewargi","Sedam","Yadgir"],
    "Kodagu": ["Madikeri","Somvarpet","Virajpet"],
    "Kolar": ["Bangarpet","KGF","Kolar","Malur","Mulbagal","Srinivaspur"],
    "Koppal": ["Gangavathi","Koppal","Kushtagi","Yelburga"],
    "Mandya": ["Kirugavalu","Krishnarajapete","Maddur","Malavalli","Mandya","Nagamangala","Pandavapura","Srirangapatna"],
    "Mysuru": ["HD Kote","Heggadadevankote","Hunsur","KR Nagar","Mysuru","Nanjangud","Periyapatna","TR Narsipur"],
    "Raichur": ["Devadurga","Lingsugur","Manvi","Raichur","Sindhanur"],
    "Ramanagara": ["Channapatna","Kanakapura","Magadi","Ramanagara"],
    "Shivamogga": ["Bhadravathi","Hosanagar","Sagara","Shikaripura","Shivamogga","Sorab","Thirthahalli"],
    "Tumakuru": ["CN Halli","Gubbi","Koratagere","Kunigal","Madhugiri","Pavagada","Sira","Tiptur","Tumakuru","Turuvekere"],
    "Udupi": ["Kundapura","Karkala","Udupi"],
    "Uttara Kannada": ["Ankola","Bhatkal","Dandeli","Haliyal","Honavar","Joida","Karwar","Kumta","Mundgod","Siddapur","Sirsi","Yellapur"],
    "Vijayapura": ["Basavana Bagewadi","Bijapur","Chadachan","Indi","Muddebihal","Sindhagi","Talikota"],
    "Vijayanagara": ["Hagaribommanahalli","Hoovina Hadagali","Kottur","Kudligi","Sandur"],
    "Yadgir": ["Gurumitkal","Hunasagi","Shahapur","Shorapur","Yadgir"]
  },

  "Tamil Nadu": {
    "Ariyalur": ["Andimadam","Ariyalur","Jayamkondam","Sendurai","Udayarpalayam"],
    "Chengalpattu": ["Cheyyur","Chengalpattu","Madurantakam","Tirukalukundram","Thirupporur"],
    "Chennai": ["Ambattur","Alandur","Chennai North","Chennai South","Sholinganallur","Tiruvottiyur"],
    "Coimbatore": ["Anaimalai","Coimbatore North","Coimbatore South","Mettupalayam","Palladam","Pollachi","Sulur","Valparai"],
    "Cuddalore": ["Bhuvanagiri","Chidambaram","Cuddalore","Kattumannarkoil","Kurinjipadi","Panruti","Srimushnam","Vriddhachalam","Tittagudi","Virudhachalam"],
    "Dharmapuri": ["Dharmapuri","Harur","Nammakkal","Palacode","Pennagaram"],
    "Dindigul": ["Attur","Dindigul","Guziliamparai","Natham","Nilakottai","Oddanchatram","Palani","Vedasandur"],
    "Erode": ["Bhavani","Erode","Gobichettipalayam","Kodumudi","Modakkurichi","Nambiyur","Perundurai","Sathyamangalam"],
    "Kallakurichi": ["Chinnasalem","Kallakurichi","Sankarapuram","Tirukoilur","Ulundurpettai"],
    "Kancheepuram": ["Kancheepuram","Kanchipuram","Maduranthakam","Sriperumbudur","Uttiramerur","Walajabad"],
    "Kanyakumari": ["Agasteeswaram","Killiyoor","Munnadi","Vilavancode","Thovalai"],
    "Karur": ["Aravakurichi","Kadavur","Karur","Krishnarayapuram","Kulithalai","Manmangalam"],
    "Krishnagiri": ["Bargur","Denkanikottai","Hosur","Krishnagiri","Pochampalli","Shoolagiri","Uthangarai","Veppanahalli"],
    "Madurai": ["Kalluppatti","Madurai North","Madurai South","Melur","Peraiyur","Tirumangalam","Usilampatti","Vadipatti"],
    "Mayiladuthurai": ["Kuttalam","Mayiladuthurai","Sirkali","Tharangambadi"],
    "Nagapattinam": ["Kilvelur","Nagapattinam","Sirkali","Tharangambadi","Thirumarugal","Vedaranyam"],
    "Namakkal": ["Kolli Hills","Kumarapalayam","Mohanur","Namakkal","Pallipalayam","Paramathi Velur","Rasipuram","Sendamangalam","Tiruchengode"],
    "Nilgiris": ["Gudalur","Kotagiri","Ooty","Pandalur"],
    "Perambalur": ["Alathur","Kunnam","Perambalur","Veppanthattai"],
    "Pudukottai": ["Alangudi","Aranthangi","Avudaiyarkoil","Gandarvakottai","Iluppur","Karambakudi","Kullathur","Manamelkudi","Ponnamaravathi","Pudukottai","Thirumayam","Viralimalai"],
    "Ramanathapuram": ["Kadaladi","Mudukulathur","Paramakudi","Ramanathapuram","Tiruvadanai"],
    "Ranipet": ["Arakkonam","Arcot","Nemili","Ranipet","Sholinghur","Walajah"],
    "Salem": ["Attur","Edappadi","Gangavalli","Mettur","Omalur","Salem","Sankari","Vazhapadi","Yercaud"],
    "Sivaganga": ["Devakottai","Ilayankudi","Kalayarkoil","Karaikudi","Manamadurai","Sivaganga","Tirupattur"],
    "Tenkasi": ["Alangulam","Kadayanallur","Sankarankovil","Shencottai","Tenkasi","Vasudevanallur"],
    "Thanjavur": ["Budalur","Kumbakonam","Orathanadu","Papanasam","Pattukottai","Peravurani","Thanjavur","Thiruvaiyaru","Thiruvidaimarudur"],
    "Theni": ["Andipatti","Bodinayakanur","Periyakulam","Theni","Uthamapalayam"],
    "Thoothukudi": ["Ettayapuram","Karunkulam","Kovilpatti","Ottapidaram","Srivaikuntam","Thoothukudi","Tiruchendur","Vilathikulam"],
    "Tiruchirappalli": ["Lalgudi","Manachanallur","Manapparai","Marungapuri","Musiri","Srirangam","Thottiam","Thuraiyur","Tiruchirappalli","Tiruverambur"],
    "Tirunelveli": ["Ambasamudram","Cheranmahadevi","Manur","Nanguneri","Palayamkottai","Radhapuram","Tenkasi","Tirunelveli","Valliyur"],
    "Tirupattur": ["Ambur","Jolarpet","Natrampalli","Tirupattur","Vaniyambadi"],
    "Tiruvallur": ["Ambattur","Gummidipoondi","Minjur","Pallipattu","Ponneri","Poonamallee","RK Pet","Tiruttani","Tiruvallur","Uttukkottai"],
    "Tiruvannamalai": ["Arni","Chetpet","Chengam","Jawadhu Hills","Kalasapakkam","Polur","Thandrampet","Tiruvannamalai","Vandavasi","Vembakkam"],
    "Vellore": ["Anaicut","Gudiyattam","Katpadi","Pernambut","Vellore","Virinchipuram"],
    "Viluppuram": ["Gingee","Kandachipuram","Marakanam","Mellur","Tirukoilur","Tindivanam","Vanur","Vikravandi","Viluppuram"],
    "Virudhunagar": ["Aruppukkottai","Kariapatti","Rajapalayam","Sattur","Sivakasi","Srivilliputtur","Tiruchuli","Virudhunagar","Watrap"]
  },

  "Kerala": {
    "Alappuzha": ["Ambalappuzha","Bharanikkavu","Chengannur","Cherthala","Harippad","Karthikappally","Kuttanad","Mavelikara","Mavelikkara"],
    "Ernakulam": ["Aluva","Ernakulam","Fort Kochi","Kochi","Kodungallur","Kolenchery","Kothamangalam","Kunnathunad","Muvattupuzha","North Paravur","Paravur","Perumbavoor","Thrippunithura","Thrissur Taluk"],
    "Idukki": ["Devikulam","Idukki","Peerumedu","Thodupuzha","Udumbanchola"],
    "Kannur": ["Iritty","Kannur","Koothuparamba","Payyannur","Taliparamba","Thaliparamba"],
    "Kasaragod": ["Hosdurg","Kasaragod","Manjeswar","Veled","Vorkady"],
    "Kollam": ["Chathannur","Ithikara","Karunagappally","Kollam","Kottarakkara","Kunnathur","Pathanapuram","Punalur"],
    "Kottayam": ["Changanassery","Ettumanoor","Kanjirappally","Kottayam","Meenachil","Pala","Vaikom"],
    "Kozhikode": ["Kozhikode","Koyilandy","Mukkam","Perambra","Thamarassery","Thiruvambady","Vadakara"],
    "Malappuram": ["Eranad","Kondotty","Malappuram","Manjeri","Nilambur","Perinthalmanna","Ponnani","Tirur","Tirurangadi"],
    "Palakkad": ["Alathur","Attappady","Chittur","Mannarkkad","Ottapalam","Palakkad","Pattambi","Shoranur","Thrithala"],
    "Pathanamthitta": ["Adoor","Konni","Kozhencherry","Mallappally","Pathanamthitta","Ranni","Tiruvalla"],
    "Thiruvananthapuram": ["Chirayinkeezhu","Kattakada","Kilimanoor","Nedumangad","Neyyattinkara","Thiruvananthapuram","Varkala"],
    "Thrissur": ["Chalakudy","Chavakkad","Kodungallur","Kunnamkulam","Mukundapuram","Talappilly","Thrissur"],
    "Wayanad": ["Kalpetta","Mananthavady","Sulthan Bathery","Tirunelli","Vythiri"]
  },

  "Andhra Pradesh": {
    "Alluri Sitharama Raju": ["Addateegala","Chintoor","Devipatnam","Maredumilli","Rambhadrapuram","Rampachodavaram","VR Puram","Yetapaka"],
    "Anakapalli": ["Anakapalli","Chodavaram","Nakkapalle","Narsipatnam","Payakaraopeta","Rambilli","Yellamanchili"],
    "Anantapur": ["Anantapur","Atmakur","Bathalapalli","Beluguppa","Bommanahal","Bukkapatnam","Chilamathur","Dharmavaram","Gummagatta","Guntakal","Hindupur","Kadiri","Kanaganapalli","Kanekal","Kurugodu","Madakasira","Mudigubba","Nallamada","Narpala","Nallacheruvu","Pamidi","Puttaparthi","Rayadurg","Singanamala","Tadimarri","Tanakal","Tadpatri","Uravakonda","Yadiki"],
    "Bapatla": ["Addanki","Bapatla","Chirala","Inkollu","Kandukur","Ongole","Parchur","Santhanuthalapadu","Vetapalem"],
    "Chittoor": ["Chittoor","Gangadhara Nellore","Gudipala","Kuppam","Madanapalle","Nagari","Palmaneru","Palamaner","Peddamandyam","Punganur","Pulivendula","Srikalahasti","Tirupati","Vayalpadu","Vedurukuppam"],
    "East Godavari": ["Amalapuram","Draksharamam","Kothapeta","Mandapeta","Peddapuram","Prathipadu","Rajanagaram","Rajamahendravaram","Ramachandrapuram","Ravulapalem","Tuni"],
    "Eluru": ["Bhimavaram","Bhimadole","Chintalapudi","Denduluru","Eluru","Jangareddygudem","Kovvur","Lingapalem","Narsapur","Palakoderu","Tanuku","Undi","West Godavari"],
    "Guntur": ["Bapatla","Chilakaluripet","Guntur","Macherla","Mangalagiri","Narasaraopet","Narasaraopeta","Ponnur","Prathipadu","Repalle","Sattenapalle","Tenali","Vemuru"],
    "Kakinada": ["Amalapuram","Kakinada","Kothapeta","Pithapuram","Prathipadu","Rajam","Tuni","Yanam"],
    "Konaseema": ["Amalapuram","Allavaram","Mummidivaram","Narsapuram","Razole"],
    "Krishna": ["Bapulapadu","Gudivada","Hindupur","Kaikaluru","Machilipatnam","Nandigama","Pamarru","Tiruvuru","Vijayawada","Vuyyuru"],
    "Kurnool": ["Adoni","Alur","Atmakur","Banaganapalle","Bethamcherla","Dhone","Dornipadu","Gudur","Holagunda","Kodumuru","Kurnool","Mahanandi","Nandyal","Orvakal","Owk","Pattikonda","Srisailam","Veldurthi","Yemmiganur"],
    "Nandyal": ["Atmakur","Bethamcherla","Dhone","Nandyal","Nandikotakur","Sirvel","Srisailam"],
    "NTR": ["Nandigama","Nidadavole","Tiruvuru","Vijayawada Rural"],
    "Palnadu": ["Dachepalle","Gurazala","Macherla","Narasaraopet","Palnadu","Sattenapalle"],
    "Prakasam": ["Addanki","Chimakurthi","Chirala","Darsi","Giddalur","Kanigiri","Kandukur","Komarolu","Markapur","Ongole","Podili","Ponnalur","Santhanuthalapadu","Tripuranthakam","Vetapalem"],
    "SPSR Nellore": ["Atmakur","Bogole","Gudur","Kovur","Naidupet","Nellore","Podalakur","Sullurpeta","Udayagiri","Venkatagiri","Vidavalur"],
    "Sri Sathya Sai": ["Dharmavaram","Hindupur","Kadiri","Kanekal","Madakasira","Puttaparthi","Rayadurg"],
    "Srikakulam": ["Amadalavalasa","Amudalavalasa","Jalumuru","Kanchili","Kaviti","Narasannapeta","Palakonda","Pathapatnam","Rajam","Saravakota","Sompeta","Srikakulam","Tekkali","Vangara","Ponduru"],
    "Tirupati": ["Chandragiri","Chittoor","Nagari","Puttur","Srikalahasti","Tirupati"],
    "Visakhapatnam": ["Anakapalli","Araku Valley","Bheemunipatnam","Chintalapudi","Chodavaram","Paderu","Visakhapatnam"],
    "Vizianagaram": ["Bobbili","Cheepurupalli","Garugubilli","Gajapathinagaram","Gurla","Jami","Kurupam","Makkuva","Nellimarla","Parvathipuram","Saluru","Srungavarapukota","Vizianagaram"]
  },

  "Telangana": {
    "Adilabad": ["Adilabad","Bazarhatnoor","Bela","Boath","Gudihatnoor","Ichoda","Jainath","Mancherial","Tamsi","Utnoor"],
    "Bhadradri Kothagudem": ["Ashwaraopeta","Bhadrachalam","Burgampahad","Cherla","Kothagudem","Manuguru","Mulugu","Palwancha","Pinapaka","Yellandu"],
    "Hanumakonda": ["Dharmasagar","Hanumakonda","Parkal","Rayaparthy","Shayampet","Venkatapur","Wardhannapet"],
    "Hyderabad": ["Bahadurpura","Charminar","Golconda","Karwan","Khairatabad","LB Nagar","Nampally","Saidabad","Secunderabad","Serlingampally","Shaikpet"],
    "Jagtial": ["Dharmapuri","Jagtial","Koratla","Metpalli","Pegadapally","Raikal","Velgatoor"],
    "Jangaon": ["Devaruppula","Jangaon","Kodakandla","Narmetta","Raghunathpally","Zaffergadh"],
    "Jayashankar Bhupalpally": ["Bhupalpally","Chityal","Mahadevpur","Manthani","Mogullapally","Palimela","Regonda"],
    "Jogulamba Gadwal": ["Alampur","Gadwal","Itikyal","Maldakal","Manopad"],
    "Kamareddy": ["Bichkunda","Domakonda","Ellareddy","Kamareddy","Machareddy","Pitlam","Ramareddy","Yellareddy"],
    "Karimnagar": ["Choppadandi","Gangadhara","Huzurabad","Jammikunta","Karimnagar","Koheda","Manakondur","Sircilla","Thimmapur"],
    "Khammam": ["Enkoor","Khammam","Konijerla","Kusumanchi","Mudigonda","Sattupalli","Thirumalayapalem","Yerrupalem"],
    "Kumuram Bheem Asifabad": ["Asifabad","Gudihatnoor","Kagaznagar","Kerameri","Narnoor","Sirpur","Tiryani","Wankidi"],
    "Mahabubabad": ["Dornakal","Gudur","Mahabubabad","Narsimhulapet","Thorrur"],
    "Mahabubnagar": ["Addakal","Amrabad","Balanagar","Bijinapally","Gadwal","Kalwakurthi","Kodangal","Kosgi","Mahabubnagar","Nagarkurnool","Narayanpet","Wanaparthy"],
    "Mancherial": ["Bellampally","Chennur","Hajipur","Jaipur","Luxettipet","Mandamarri","Mancherial","Naspur","Kotapalli"],
    "Medak": ["Dubbak","Havelighanpur","Medak","Narsapur","Ramayampet","Shankarasamudram","Siddipet","Toopran"],
    "Medchal-Malkajgiri": ["Dundigal","Ghatkesar","Medchal","Quthbullapur","Uppal"],
    "Mulugu": ["Eturnagaram","Mulugu","Tadwai","Tadvai","Venkatapuram","Wazeedu"],
    "Nagarkurnool": ["Achampet","Bijinapally","Kalwakurthi","Kollapur","Midjil","Nagarkurnool","Wanaparthy"],
    "Nalgonda": ["Bhongir","Choutuppal","Devarakonda","Miryalaguda","Nalgonda","Nakrekal","Suryapet","Tirumalagiri","Yadagirigutta"],
    "Narayanpet": ["Gopalpet","Maganur","Makthal","Narayanpet"],
    "Nirmal": ["Armur","Bhainsa","Dilawarpur","Khanapur","Kubeer","Lokeshwaram","Mudhole","Nirmal","Narsapur","Sarangapur"],
    "Nizamabad": ["Banswada","Bheemgal","Bodhan","Dichpally","Kotagiri","Nizamabad","Machareddy","Navipet","Nizamsagar","Yellareddy"],
    "Peddapalli": ["Dharmaram","Elkathurthi","Godavarikhani","Julapur","Manthani","Peddapalli","Ramagundam","Sultanabad"],
    "Rajanna Sircilla": ["Boinpally","Gambhiraopet","Illanthakunta","Koheda","Mustabad","Sircilla","Vemulawada"],
    "Ranga Reddy": ["Hayathnagar","Ibrahimpatnam","Kandukur","Maheshwaram","Rajendranagar","Shamshabad","Vikarabad"],
    "Sangareddy": ["Andole","Gummadidala","Jogipet","Kohir","Narayankhed","Patancheru","Pulkal","Ramachandrapuram","Sangareddy","Zahirabad"],
    "Siddipet": ["Chinnakodur","Doultabad","Dubbak","Gajwel","Husnabad","Kodimial","Koheda","Siddipet","Thoguta"],
    "Suryapet": ["Chivvemla","Huzurnagar","Kodad","Mellacheruvu","Mothkur","Nereducharla","Suryapet","Tungathurthi"],
    "Vikarabad": ["Pargi","Pudur","Tandur","Vikarabad"],
    "Wanaparthy": ["Atmakur","Gopalpet","Kothakota","Pebbair","Rever","Wanaparthy"],
    "Warangal": ["Dharmasagar","Narsampet","Parkal","Shayampet","Warangal","Wardhannapet"],
    "Yadadri Bhongir": ["Addakal","Bhongir","Bibinagar","Choutuppal","Mothkur","Yadagirigutta","Yadadri"]
  }
};

// ============================================================
// MAIN PROCESSING
// ============================================================

function buildFromBuiltIn() {
  const output = {};
  for (const [state, districts] of Object.entries(BUILT_IN_DATA)) {
    output[state] = {};
    for (const [district, taluks] of Object.entries(districts)) {
      output[state][district] = taluks.sort();
    }
  }
  return output;
}

function buildFromCSV(csvPath) {
  return new Promise((resolve, reject) => {
    try {
      const csv = require('csv-parser');
      const results = {};
      require('fs').createReadStream(csvPath)
        .pipe(csv())
        .on('data', (row) => {
          const state = (row.StateName || row.state_name || row.STATE || '').trim();
          const district = (row.DistrictName || row.district_name || row.DISTRICT || '').trim();
          const taluk = (row.SubDistrictName || row.sub_district_name || row.TALUK || row.SUB_DISTRICT || '').trim();

          if (!STATE_FILTER.includes(state)) return;
          if (!state || !district || !taluk) return;

          if (!results[state]) results[state] = {};
          if (!results[state][district]) results[state][district] = new Set();
          results[state][district].add(taluk);
        })
        .on('end', () => {
          // Convert Sets to sorted Arrays
          const output = {};
          for (const [state, districts] of Object.entries(results)) {
            output[state] = {};
            for (const [district, taluks] of Object.entries(districts)) {
              output[state][district] = [...taluks].sort();
            }
          }
          resolve(output);
        })
        .on('error', reject);
    } catch (e) {
      reject(e);
    }
  });
}

async function main() {
  const csvPath = path.join(__dirname, 'sub_districts.csv');
  const outDir = path.join(__dirname, '..', 'frontend', 'data');
  const outPath = path.join(outDir, 'south_india_locations.json');

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
    console.log(`Created output directory: ${outDir}`);
  }

  let locationData;

  if (fs.existsSync(csvPath)) {
    console.log(`Found sub_districts.csv — processing CSV...`);
    try {
      locationData = await buildFromCSV(csvPath);
      console.log(`CSV processed successfully.`);
    } catch (e) {
      console.warn(`CSV processing failed (${e.message}), falling back to built-in data.`);
      locationData = buildFromBuiltIn();
    }
  } else {
    console.log(`No sub_districts.csv found — using built-in South India data.`);
    locationData = buildFromBuiltIn();
  }

  // Build summary stats
  let totalStates = 0, totalDistricts = 0, totalTaluks = 0;
  for (const [state, districts] of Object.entries(locationData)) {
    totalStates++;
    for (const [district, taluks] of Object.entries(districts)) {
      totalDistricts++;
      totalTaluks += taluks.length;
    }
  }

  fs.writeFileSync(outPath, JSON.stringify(locationData, null, 2), 'utf8');
  console.log(`\n✅ south_india_locations.json written successfully!`);
  console.log(`   States: ${totalStates}`);
  console.log(`   Districts: ${totalDistricts}`);
  console.log(`   Taluks: ${totalTaluks}`);
  console.log(`   Output: ${outPath}`);
}

main().catch(err => {
  console.error('Build failed:', err.message);
  process.exit(1);
});
