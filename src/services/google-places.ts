/**
 * Google Places API (New) Service
 *
 * Uses the new Places API v1 endpoints:
 * - Text Search: https://places.googleapis.com/v1/places:searchText
 * - Place Details: https://places.googleapis.com/v1/places/{placeId}
 * - Photos: https://places.googleapis.com/v1/{photoName}/media
 */

import { logger } from "../config/logger";

// ===========================
// TYPE DEFINITIONS
// ===========================

export interface GooglePlacePhoto {
  name: string;
  widthPx: number;
  heightPx: number;
  authorAttributions?: Array<{
    displayName: string;
    uri: string;
  }>;
}

export interface GooglePlaceOpeningHours {
  openNow?: boolean;
  weekdayDescriptions?: string[];
  periods?: Array<{
    open: { day: number; hour: number; minute: number };
    close?: { day: number; hour: number; minute: number };
  }>;
}

export interface GooglePlace {
  id: string;
  displayName?: {
    text: string;
    languageCode: string;
  };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  regularOpeningHours?: GooglePlaceOpeningHours;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: "PRICE_LEVEL_FREE" | "PRICE_LEVEL_INEXPENSIVE" | "PRICE_LEVEL_MODERATE" | "PRICE_LEVEL_EXPENSIVE" | "PRICE_LEVEL_VERY_EXPENSIVE";
  types?: string[];
  primaryType?: string;
  editorialSummary?: {
    text: string;
    languageCode: string;
  };
  photos?: GooglePlacePhoto[];
}

export interface GoogleTextSearchResponse {
  places?: GooglePlace[];
  nextPageToken?: string;
}

export type ShopCategory = "bar" | "restaurant" | "bakery" | "wellness" | "pastry" | "cafe" | "retail" | "other";

export interface MappedShopData {
  external_place_id: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  opening_hours: string | null;
  description: string | null;
  image_url: string | null;
  shop_category: ShopCategory | null;
  rating: number | null;
  rating_count: number | null;
  price_level: number | null;
  google_maps_url: string | null;
}

// ===========================
// TYPE MAPPING
// ===========================

const GOOGLE_TYPE_TO_CATEGORY: Record<string, ShopCategory> = {
  // Cafe
  "cafe": "cafe",
  "coffee_shop": "cafe",
  "tea_house": "cafe",

  // Bar
  "bar": "bar",
  "pub": "bar",
  "wine_bar": "bar",
  "bar_and_grill": "bar",
  "night_club": "bar",

  // Restaurant
  "restaurant": "restaurant",
  "american_restaurant": "restaurant",
  "asian_restaurant": "restaurant",
  "barbecue_restaurant": "restaurant",
  "brazilian_restaurant": "restaurant",
  "breakfast_restaurant": "restaurant",
  "brunch_restaurant": "restaurant",
  "chinese_restaurant": "restaurant",
  "fast_food_restaurant": "restaurant",
  "french_restaurant": "restaurant",
  "greek_restaurant": "restaurant",
  "hamburger_restaurant": "restaurant",
  "indian_restaurant": "restaurant",
  "indonesian_restaurant": "restaurant",
  "italian_restaurant": "restaurant",
  "japanese_restaurant": "restaurant",
  "korean_restaurant": "restaurant",
  "lebanese_restaurant": "restaurant",
  "mediterranean_restaurant": "restaurant",
  "mexican_restaurant": "restaurant",
  "middle_eastern_restaurant": "restaurant",
  "pizza_restaurant": "restaurant",
  "ramen_restaurant": "restaurant",
  "seafood_restaurant": "restaurant",
  "spanish_restaurant": "restaurant",
  "steak_house": "restaurant",
  "sushi_restaurant": "restaurant",
  "thai_restaurant": "restaurant",
  "turkish_restaurant": "restaurant",
  "vegan_restaurant": "restaurant",
  "vegetarian_restaurant": "restaurant",
  "vietnamese_restaurant": "restaurant",
  "fine_dining_restaurant": "restaurant",

  // Bakery
  "bakery": "bakery",
  "donut_shop": "bakery",

  // Pastry
  "dessert_shop": "pastry",
  "dessert_restaurant": "pastry",
  "ice_cream_shop": "pastry",
  "chocolate_shop": "pastry",
  "candy_store": "pastry",

  // Wellness
  "spa": "wellness",
  "beauty_salon": "wellness",
  "hair_salon": "wellness",
  "nail_salon": "wellness",
  "massage": "wellness",
  "skin_care_clinic": "wellness",
  "yoga_studio": "wellness",

  // Retail
  "grocery_store": "retail",
  "supermarket": "retail",
  "convenience_store": "retail",
  "food_store": "retail",
  "butcher_shop": "retail",
};

// Google types we want to search for
export const SUPPORTED_GOOGLE_TYPES = [
  "cafe",
  "coffee_shop",
  "bar",
  "pub",
  "wine_bar",
  "restaurant",
  "bakery",
  "spa",
  "beauty_salon",
  "hair_salon",
  "ice_cream_shop",
];

// ===========================
// HELPER FUNCTIONS
// ===========================

function mapGoogleTypeToCategory(types: string[] | undefined): ShopCategory | null {
  if (!types || types.length === 0) return null;

  // Check primary type first, then others
  for (const type of types) {
    if (GOOGLE_TYPE_TO_CATEGORY[type]) {
      return GOOGLE_TYPE_TO_CATEGORY[type];
    }
  }

  return "other";
}

function mapPriceLevel(priceLevel: string | undefined): number | null {
  if (!priceLevel) return null;

  const mapping: Record<string, number> = {
    "PRICE_LEVEL_FREE": 1,
    "PRICE_LEVEL_INEXPENSIVE": 1,
    "PRICE_LEVEL_MODERATE": 2,
    "PRICE_LEVEL_EXPENSIVE": 3,
    "PRICE_LEVEL_VERY_EXPENSIVE": 4,
  };

  return mapping[priceLevel] || null;
}

function formatOpeningHours(hours: GooglePlaceOpeningHours | undefined): string | null {
  if (!hours?.weekdayDescriptions) return null;
  return hours.weekdayDescriptions.join("\n");
}

// ===========================
// GOOGLE PLACES SERVICE
// ===========================

export class GooglePlacesService {
  private apiKey: string;
  private baseUrl = "https://places.googleapis.com/v1";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Search for places using text query
   */
  async searchPlaces(options: {
    query: string;
    locationBias?: { latitude: number; longitude: number; radiusMeters: number };
    includedTypes?: string[];
    maxResults?: number;
    languageCode?: string;
  }): Promise<GooglePlace[]> {
    const { query, locationBias, includedTypes, maxResults = 20, languageCode = "sl" } = options;

    // Field mask for Enterprise tier (we need phone, website, hours, rating)
    const fieldMask = [
      "places.id",
      "places.displayName",
      "places.formattedAddress",
      "places.nationalPhoneNumber",
      "places.websiteUri",
      "places.googleMapsUri",
      "places.regularOpeningHours",
      "places.rating",
      "places.userRatingCount",
      "places.priceLevel",
      "places.types",
      "places.primaryType",
      "places.editorialSummary",
      "places.photos",
    ].join(",");

    const requestBody: any = {
      textQuery: query,
      languageCode,
      maxResultCount: maxResults,
    };

    // Add location bias if provided
    if (locationBias) {
      requestBody.locationBias = {
        circle: {
          center: {
            latitude: locationBias.latitude,
            longitude: locationBias.longitude,
          },
          radius: locationBias.radiusMeters,
        },
      };
    }

    // Add type filter if provided
    if (includedTypes && includedTypes.length > 0) {
      requestBody.includedType = includedTypes[0]; // API only supports one type
    }

    try {
      const response = await fetch(`${this.baseUrl}/places:searchText`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": fieldMask,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error("Google Places API error:", error);
        throw new Error(`Google Places API error: ${response.status} - ${error}`);
      }

      const data: GoogleTextSearchResponse = await response.json();
      return data.places || [];
    } catch (error) {
      logger.error("Failed to search Google Places:", error);
      throw error;
    }
  }

  /**
   * Get photo URL for a place photo
   */
  async getPhotoUrl(photoName: string, maxHeightPx: number = 800): Promise<string | null> {
    try {
      // The photo URL redirects to the actual image
      const photoUrl = `${this.baseUrl}/${photoName}/media?maxHeightPx=${maxHeightPx}&key=${this.apiKey}`;

      // Fetch to get the redirect URL
      const response = await fetch(photoUrl, {
        method: "GET",
        redirect: "manual", // Don't follow redirect, we want the URL
      });

      // The redirect location contains the actual image URL
      const imageUrl = response.headers.get("location");

      if (imageUrl) {
        return imageUrl;
      }

      // If no redirect, the URL itself might work
      if (response.ok) {
        return photoUrl;
      }

      return null;
    } catch (error) {
      logger.error("Failed to get photo URL:", error);
      return null;
    }
  }

  /**
   * Map a Google Place to our shop data format
   */
  async mapPlaceToShopData(place: GooglePlace): Promise<MappedShopData> {
    // Get photo URL if available
    let imageUrl: string | null = null;
    if (place.photos && place.photos.length > 0) {
      imageUrl = await this.getPhotoUrl(place.photos[0].name);
    }

    return {
      external_place_id: place.id,
      name: place.displayName?.text || "Unknown",
      address: place.formattedAddress || null,
      phone: place.nationalPhoneNumber || null,
      website: place.websiteUri || null,
      opening_hours: formatOpeningHours(place.regularOpeningHours),
      description: place.editorialSummary?.text || null,
      image_url: imageUrl,
      shop_category: mapGoogleTypeToCategory(place.types),
      rating: place.rating || null,
      rating_count: place.userRatingCount || null,
      price_level: mapPriceLevel(place.priceLevel),
      google_maps_url: place.googleMapsUri || null,
    };
  }

  /**
   * Search and map places in one call
   */
  async searchAndMapPlaces(options: {
    query: string;
    locationBias?: { latitude: number; longitude: number; radiusMeters: number };
    includedTypes?: string[];
    maxResults?: number;
    languageCode?: string;
  }): Promise<MappedShopData[]> {
    const places = await this.searchPlaces(options);

    const mappedPlaces = await Promise.all(
      places.map(place => this.mapPlaceToShopData(place))
    );

    return mappedPlaces;
  }
}

// ===========================
// SINGLETON INSTANCE
// ===========================

let googlePlacesService: GooglePlacesService | null = null;

export function getGooglePlacesService(): GooglePlacesService {
  if (!googlePlacesService) {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      throw new Error("GOOGLE_PLACES_API_KEY environment variable is not set");
    }
    googlePlacesService = new GooglePlacesService(apiKey);
  }
  return googlePlacesService;
}
