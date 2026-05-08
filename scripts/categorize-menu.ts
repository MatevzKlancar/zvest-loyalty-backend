#!/usr/bin/env bun
/**
 * Menu Article Categorization Script
 *
 * Auto-categorizes menu articles for a specific shop into Slovenian categories.
 *
 * Categories:
 * - Kave (Coffee drinks)
 * - Brezalkoholne pijače (Non-alcoholic beverages)
 * - Alkoholne pijače (Alcoholic beverages)
 * - Hrana (Food items)
 *
 * Usage:
 *   bun run scripts/categorize-menu.ts
 */

import { createClient } from "@supabase/supabase-js";

// Target shop ID
const SHOP_ID = "3325c1c4-96e5-4d9a-90ab-c8e71775591f";

// Categories
const CATEGORIES = {
  KAVE: "Kave",
  BREZALKOHOLNE: "Brezalkoholne pijače",
  ALKOHOLNE: "Alkoholne pijače",
  HRANA: "Hrana",
} as const;

// Keywords for categorization (lowercase)
const COFFEE_KEYWORDS = [
  "kava",
  "espresso",
  "cappuccino",
  "capuccino",
  "latte",
  "macchiato",
  "americano",
  "ristretto",
  "mocha",
  "mokka",
  "coffee",
  "lungo",
  "cortado",
  "flat white",
  "flatwhite",
  "caffè",
  "caffe",
  "ječmenova", // barley coffee
  "babyccino",
  "brezkofeinska", // decaf
  "brezkofeinski",
];

const NON_ALCOHOLIC_KEYWORDS = [
  "sok",
  "juice",
  "čaj",
  "tea",
  "voda",
  "water",
  "mineralna",
  "coca",
  "cola",
  "sprite",
  "fanta",
  "schweppes",
  "redbull",
  "red bull",
  "cockta",
  "limonada",
  "ledeni",
  "smoothie",
  "frape",
  "frappe",
  "milkshake",
  "kakao",
  "kakav",
  "cedevita",
  "zele",
  "tonic",
  "tonik",
  "bitter lemon",
  "ginger",
  "ingver",
  "ora",
  "oranžada",
  "gazirana",
  "negazirana",
  "jana",
  "radenska",
  "zala",
  "pepsi",
  "7up",
  "ice tea",
  "ledeni čaj",
  "pomarančni",
  "jabolčni",
  "bezgov",
  "limona",
  "malinovec",
  "borovničevec",
  "energijska",
  "naturelle",
  "grog",
  "tangerine",
];

const ALCOHOLIC_KEYWORDS = [
  "pivo",
  "beer",
  "vino",
  "wine",
  "žganje",
  "viski",
  "whisky",
  "whiskey",
  "vodka",
  "gin",
  "rum",
  "tekila",
  "tequila",
  "koktajl",
  "cocktail",
  "aperol",
  "spritz",
  "hugo",
  "mojito",
  "margarita",
  "prosecco",
  "šampanjec",
  "champagne",
  "radler",
  "cider",
  "liker",
  "brandy",
  "cognac",
  "konjak",
  "jäger",
  "jagermeister",
  "aperitiv",
  "laško",
  "union",
  "heineken",
  "corona",
  "stella",
  "hoegaarden",
  "leffe",
  "guinness",
  "somersby",
  "malibu",
  "baileys",
  "bailey",
  "bacardi",
  "campari",
  "martini",
  "vermouth",
  "vermut",
  "šnops",
  "žganica",
  "medica",
  "brinjevec",
  "slivovka",
  "hruškovec",
  "williamsovka",
  "viljamovka",
  "sadjevec",
  "pelinkovec",
  "borovničke",
  "travarica",
  "cabernet",
  "cviček",
  "haložan",
  "malvazija",
  "penina",
  "sangria",
  "havana",
  "jack daniel",
  "jameson",
  "limonce",
  "southern comfort",
  "stock",
  "cynar",
  "shanky",
  "skrewball",
  "cuba libre",
  "lintvern",
  "hoppy",
  "lager",
  "nefiltrirano",
  "malt",
  "red breast",
  "diplomatico",
  "kraken",
];

// Non-alcoholic beer patterns (checked before alcoholic)
const NON_ALCOHOLIC_BEER_PATTERNS = [
  "brezalkoholno",
  "brezalk",
  "0,0",
  "0.0",
  "alcohol free",
  "non-alcoholic",
];

// Special drink keywords that might be confused with food
const DRINK_INDICATORS = [
  "čokolada", // hot chocolate drink
  "vroča čokolada",
  "topla čokolada",
];

interface Article {
  id: string;
  name: string;
  category: string | null;
  base_price: number;
}

function isNonAlcoholicBeer(name: string): boolean {
  const lowerName = name.toLowerCase();
  // Must contain a beer-related keyword AND a non-alcoholic indicator
  const beerKeywords = ["pivo", "beer", "lager", "heineken", "laško", "union", "hoppy"];
  const nonAlcIndicators = ["brezalkoholno", "brezalk", "0,0", "0.0", "alcohol free", "non-alcoholic"];

  const hasBeerKeyword = beerKeywords.some(kw => lowerName.includes(kw));
  const hasNonAlcIndicator = nonAlcIndicators.some(ind => lowerName.includes(ind));

  return hasBeerKeyword && hasNonAlcIndicator;
}

function categorizeArticle(name: string): string {
  const lowerName = name.toLowerCase();

  // Check for coffee first (most specific)
  for (const keyword of COFFEE_KEYWORDS) {
    if (lowerName.includes(keyword)) {
      return CATEGORIES.KAVE;
    }
  }

  // Check for non-alcoholic beer BEFORE alcoholic (e.g., "Heineken brezalkoholno")
  if (isNonAlcoholicBeer(lowerName)) {
    return CATEGORIES.BREZALKOHOLNE;
  }

  // Check for alcoholic beverages
  for (const keyword of ALCOHOLIC_KEYWORDS) {
    if (lowerName.includes(keyword)) {
      return CATEGORIES.ALKOHOLNE;
    }
  }

  // Check for non-alcoholic beverages
  for (const keyword of NON_ALCOHOLIC_KEYWORDS) {
    if (lowerName.includes(keyword)) {
      return CATEGORIES.BREZALKOHOLNE;
    }
  }

  // Check for drink indicators (like hot chocolate)
  for (const keyword of DRINK_INDICATORS) {
    if (lowerName.includes(keyword)) {
      return CATEGORIES.BREZALKOHOLNE;
    }
  }

  // Default to food
  return CATEGORIES.HRANA;
}

async function main() {
  // Get environment variables
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables");
    console.error("   Make sure your .env file is configured correctly");
    process.exit(1);
  }

  // Create Supabase client
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  console.log("🍽️  Menu Article Categorization Script");
  console.log("=".repeat(60));
  console.log(`📍 Shop ID: ${SHOP_ID}`);
  console.log("");

  // Fetch all articles for the shop
  console.log("📥 Fetching articles...");
  const { data: articles, error: fetchError } = await supabase
    .from("articles")
    .select("id, name, category, base_price")
    .eq("shop_id", SHOP_ID)
    .eq("is_active", true)
    .order("name");

  if (fetchError) {
    console.error("❌ Error fetching articles:", fetchError.message);
    process.exit(1);
  }

  if (!articles || articles.length === 0) {
    console.log("⚠️  No articles found for this shop");
    process.exit(0);
  }

  console.log(`✅ Found ${articles.length} articles`);
  console.log("");

  // Categorize each article
  const categorizedArticles: Array<{
    id: string;
    name: string;
    oldCategory: string | null;
    newCategory: string;
  }> = [];

  for (const article of articles as Article[]) {
    const newCategory = categorizeArticle(article.name);
    categorizedArticles.push({
      id: article.id,
      name: article.name,
      oldCategory: article.category,
      newCategory,
    });
  }

  // Group by category for display
  const byCategory: Record<string, typeof categorizedArticles> = {};
  for (const article of categorizedArticles) {
    if (!byCategory[article.newCategory]) {
      byCategory[article.newCategory] = [];
    }
    byCategory[article.newCategory].push(article);
  }

  // Display categorization preview
  console.log("📋 Categorization Preview:");
  console.log("=".repeat(60));

  for (const [category, items] of Object.entries(byCategory)) {
    console.log(`\n📁 ${category} (${items.length} items):`);
    for (const item of items) {
      const changeIndicator = item.oldCategory !== item.newCategory ? " ← changed" : "";
      console.log(`   - ${item.name}${changeIndicator}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("💾 Updating database...\n");

  // Update articles in database
  let successCount = 0;
  let errorCount = 0;

  for (const article of categorizedArticles) {
    const { error: updateError } = await supabase
      .from("articles")
      .update({ category: article.newCategory })
      .eq("id", article.id);

    if (updateError) {
      console.error(`❌ Error updating "${article.name}": ${updateError.message}`);
      errorCount++;
    } else {
      successCount++;
    }
  }

  console.log("=".repeat(60));
  console.log(`✅ Successfully updated: ${successCount} articles`);
  if (errorCount > 0) {
    console.log(`❌ Errors: ${errorCount} articles`);
  }

  // Summary by category
  console.log("\n📊 Category Summary:");
  console.log("-".repeat(40));
  for (const [category, items] of Object.entries(byCategory)) {
    console.log(`   ${category}: ${items.length} items`);
  }

  console.log("\n✨ Categorization complete!");
}

if (import.meta.main) {
  main().catch(console.error);
}
