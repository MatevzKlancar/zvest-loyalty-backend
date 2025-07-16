import { supabase } from "../config/database";
import { logger } from "../config/logger";

export interface ImageUploadResult {
  success: boolean;
  image_url?: string;
  error?: string;
}

/**
 * Upload an image to Supabase Storage
 * @param file - The image file to upload
 * @param shopId - The shop ID for organizing files
 * @param fileName - Optional custom filename
 * @returns Promise with upload result
 */
export async function uploadShopImage(
  file: File,
  shopId: string,
  fileName?: string
): Promise<ImageUploadResult> {
  try {
    // Generate filename if not provided
    if (!fileName) {
      const timestamp = new Date().getTime();
      const extension = file.name.split(".").pop();
      fileName = `shop-${shopId}-${timestamp}.${extension}`;
    }

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from("shop-images")
      .upload(`shops/${shopId}/${fileName}`, file, {
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      logger.error("Failed to upload image to Supabase Storage:", error);
      return {
        success: false,
        error: "Failed to upload image",
      };
    }

    // Get the public URL
    const { data: publicUrlData } = supabase.storage
      .from("shop-images")
      .getPublicUrl(data.path);

    logger.info(`Image uploaded successfully: ${publicUrlData.publicUrl}`);

    return {
      success: true,
      image_url: publicUrlData.publicUrl,
    };
  } catch (error) {
    logger.error("Error uploading image:", error);
    return {
      success: false,
      error: "Internal server error",
    };
  }
}

/**
 * Delete an image from Supabase Storage
 * @param imageUrl - The full URL of the image to delete
 * @param shopId - The shop ID for organizing files
 * @returns Promise with deletion result
 */
export async function deleteShopImage(
  imageUrl: string,
  shopId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Extract the path from the URL
    const url = new URL(imageUrl);
    const pathParts = url.pathname.split("/");
    const bucketIndex = pathParts.indexOf("shop-images");

    if (bucketIndex === -1) {
      return {
        success: false,
        error: "Invalid image URL format",
      };
    }

    const filePath = pathParts.slice(bucketIndex + 1).join("/");

    // Delete from Supabase Storage
    const { error } = await supabase.storage
      .from("shop-images")
      .remove([filePath]);

    if (error) {
      logger.error("Failed to delete image from Supabase Storage:", error);
      return {
        success: false,
        error: "Failed to delete image",
      };
    }

    logger.info(`Image deleted successfully: ${imageUrl}`);

    return {
      success: true,
    };
  } catch (error) {
    logger.error("Error deleting image:", error);
    return {
      success: false,
      error: "Internal server error",
    };
  }
}

/**
 * Get the signed URL for a private image (if using RLS)
 * @param imagePath - The path to the image in storage
 * @param expiresIn - Expiration time in seconds (default: 1 hour)
 * @returns Promise with signed URL
 */
export async function getSignedImageUrl(
  imagePath: string,
  expiresIn: number = 3600
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const { data, error } = await supabase.storage
      .from("shop-images")
      .createSignedUrl(imagePath, expiresIn);

    if (error) {
      logger.error("Failed to create signed URL:", error);
      return {
        success: false,
        error: "Failed to create signed URL",
      };
    }

    return {
      success: true,
      url: data.signedUrl,
    };
  } catch (error) {
    logger.error("Error creating signed URL:", error);
    return {
      success: false,
      error: "Internal server error",
    };
  }
}
