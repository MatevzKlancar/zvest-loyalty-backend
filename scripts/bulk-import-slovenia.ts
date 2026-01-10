/**
 * Bulk Import Script for Slovenian Places
 *
 * Imports 2 places of each category for top 40 Slovenian cities
 */

const API_BASE = "http://localhost:3000/api/admin";

// Top 40 Slovenian cities with coordinates
const CITIES = [
  { name: "Ljubljana", lat: 46.0569, lng: 14.5058 },
  { name: "Maribor", lat: 46.5547, lng: 15.6459 },
  { name: "Celje", lat: 46.2364, lng: 15.2677 },
  { name: "Kranj", lat: 46.2389, lng: 14.3556 },
  { name: "Koper", lat: 45.5469, lng: 13.7294 },
  { name: "Velenje", lat: 46.3594, lng: 15.1108 },
  { name: "Novo Mesto", lat: 45.8014, lng: 15.1689 },
  { name: "Ptuj", lat: 46.4200, lng: 15.8700 },
  { name: "Trbovlje", lat: 46.1500, lng: 15.0500 },
  { name: "Kamnik", lat: 46.2256, lng: 14.6119 },
  { name: "Jesenice", lat: 46.4364, lng: 14.0528 },
  { name: "Nova Gorica", lat: 45.9558, lng: 13.6419 },
  { name: "Domžale", lat: 46.1378, lng: 14.5944 },
  { name: "Škofja Loka", lat: 46.1656, lng: 14.3067 },
  { name: "Murska Sobota", lat: 46.6625, lng: 16.1664 },
  { name: "Izola", lat: 45.5386, lng: 13.6603 },
  { name: "Postojna", lat: 45.7742, lng: 14.2153 },
  { name: "Logatec", lat: 45.9178, lng: 14.2283 },
  { name: "Ajdovščina", lat: 45.8872, lng: 13.9094 },
  { name: "Kočevje", lat: 45.6428, lng: 14.8633 },
  { name: "Slovenj Gradec", lat: 46.5094, lng: 15.0806 },
  { name: "Ravne na Koroškem", lat: 46.5431, lng: 14.9508 },
  { name: "Sežana", lat: 45.7069, lng: 13.8736 },
  { name: "Bled", lat: 46.3683, lng: 14.1144 },
  { name: "Piran", lat: 45.5283, lng: 13.5681 },
  { name: "Radovljica", lat: 46.3444, lng: 14.1744 },
  { name: "Črnomelj", lat: 45.5711, lng: 15.1883 },
  { name: "Litija", lat: 46.0578, lng: 14.8314 },
  { name: "Trebnje", lat: 45.9069, lng: 15.0125 },
  { name: "Grosuplje", lat: 45.9556, lng: 14.6589 },
  { name: "Brežice", lat: 45.9053, lng: 15.5931 },
  { name: "Zagorje ob Savi", lat: 46.1319, lng: 14.9972 },
  { name: "Hrastnik", lat: 46.1417, lng: 15.0833 },
  { name: "Šentjur", lat: 46.2181, lng: 15.3956 },
  { name: "Idrija", lat: 46.0028, lng: 14.0292 },
  { name: "Krško", lat: 45.9586, lng: 15.4931 },
  { name: "Sevnica", lat: 46.0083, lng: 15.3039 },
  { name: "Vrhnika", lat: 45.9653, lng: 14.2958 },
  { name: "Mengeš", lat: 46.1658, lng: 14.5722 },
  { name: "Šoštanj", lat: 46.3792, lng: 15.0486 },
];

// Categories to search (Slovenian search terms work better)
const CATEGORIES = [
  { query: "restavracija", label: "restaurant" },
  { query: "kavarna", label: "cafe" },
  { query: "wellness spa", label: "wellness" },
  { query: "pekarna", label: "bakery" },
  { query: "frizer", label: "hairdresser" },
  { query: "brivnica barber", label: "barber" },
  { query: "masaža massage", label: "massage" },
  { query: "bar lounge", label: "bar" },
  { query: "pizzerija pizza", label: "pizzeria" },
  { query: "burger", label: "burger" },
  { query: "slaščičarna", label: "pastry" },
  { query: "gostilna", label: "pub" },
];

const PLACES_PER_CATEGORY = 2;

interface Place {
  external_place_id: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  opening_hours: string | null;
  description: string | null;
  image_url: string | null;
  shop_category: string | null;
  rating: number | null;
  rating_count: number | null;
  price_level: number | null;
  google_maps_url: string | null;
}

let token = "";

async function login(): Promise<string> {
  const response = await fetch(`${API_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "matevz1998@gmail.com",
      password: "123321",
    }),
  });

  const data = await response.json();
  if (!data.data?.jwt_token) {
    throw new Error("Login failed");
  }
  return data.data.jwt_token;
}

async function searchPlaces(query: string, city: typeof CITIES[0]): Promise<Place[]> {
  const response = await fetch(`${API_BASE}/google/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      query: `${query} ${city.name}`,
      location: {
        latitude: city.lat,
        longitude: city.lng,
        radiusMeters: 5000,
      },
      maxResults: PLACES_PER_CATEGORY + 3, // Get a few extra in case some fail
    }),
  });

  const data = await response.json();
  return data.data?.places || [];
}

async function bulkImport(places: Place[]): Promise<{ imported: number; skipped: number }> {
  if (places.length === 0) return { imported: 0, skipped: 0 };

  const response = await fetch(`${API_BASE}/google/bulk-import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ places: places.slice(0, PLACES_PER_CATEGORY) }),
  });

  const data = await response.json();
  return {
    imported: data.data?.imported || 0,
    skipped: data.data?.skipped || 0,
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log("🚀 Starting bulk import for Slovenia...\n");
  console.log(`📊 Plan: ${CITIES.length} cities × ${CATEGORIES.length} categories × ${PLACES_PER_CATEGORY} places = ${CITIES.length * CATEGORIES.length * PLACES_PER_CATEGORY} places\n`);

  // Login
  console.log("🔐 Logging in...");
  token = await login();
  console.log("✅ Login successful\n");

  let totalImported = 0;
  let totalSkipped = 0;
  let totalSearches = 0;

  for (const city of CITIES) {
    console.log(`\n🏙️  ${city.name}`);
    console.log("─".repeat(40));

    for (const category of CATEGORIES) {
      try {
        // Search
        const places = await searchPlaces(category.query, city);
        totalSearches++;

        if (places.length === 0) {
          console.log(`   ⚠️  ${category.label}: No results`);
          continue;
        }

        // Import
        const result = await bulkImport(places);
        totalImported += result.imported;
        totalSkipped += result.skipped;

        console.log(`   ✅ ${category.label}: +${result.imported} imported, ${result.skipped} skipped`);

        // Small delay to avoid rate limiting
        await sleep(200);

      } catch (error) {
        console.log(`   ❌ ${category.label}: Error - ${error}`);
      }
    }
  }

  console.log("\n" + "═".repeat(50));
  console.log("📊 IMPORT COMPLETE");
  console.log("═".repeat(50));
  console.log(`   Total searches: ${totalSearches}`);
  console.log(`   Total imported: ${totalImported}`);
  console.log(`   Total skipped:  ${totalSkipped}`);
  console.log("═".repeat(50));
}

main().catch(console.error);
