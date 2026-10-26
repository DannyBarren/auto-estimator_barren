"use client";

import React, { useState, ChangeEvent, FormEvent } from "react";
import { createClient } from "@supabase/supabase-js";

// PASTE YOUR CALENDLY / ACUITY / BOOKING LINK HERE:
const BOOKING_URL = "https://calendly.com";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
const supabase = createClient(supabaseUrl, supabaseKey);

const compressImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const rawBase64 = event.target?.result as string;
      if (!rawBase64) {
        reject(new Error("Unable to read selected image file."));
        return;
      }

      const img = new Image();
      img.src = rawBase64;

      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          const MAX_WIDTH = 1024;
          let width = img.width;
          let height = img.height;

          if (width > MAX_WIDTH) {
            height = Math.round((height * MAX_WIDTH) / width);
            width = MAX_WIDTH;
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL("image/jpeg", 0.7));
            return;
          }
        } catch (e) {
          console.warn("[Canvas Warning] Compression fallback engaged:", e);
        }
        resolve(rawBase64);
      };

      img.onerror = () => resolve(rawBase64);
    };

    reader.onerror = () => reject(new Error("Failed to read image file."));
  });
};

export default function EstimateForm() {
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [estimateResult, setEstimateResult] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [isDecodingVin, setIsDecodingVin] = useState(false);
  const [vinStatus, setVinStatus] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    vinNumber: "",
    customerName: "",
    customerPhone: "",
    vehicleYear: "",
    vehicleMake: "",
    vehicleModel: "",
    damageDescription: "",
  });

  const handleInputChange = (
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const decodeVin = async (vinToDecode: string) => {
    const cleanVin = vinToDecode.trim().toUpperCase();
    if (cleanVin.length !== 17) {
      setVinStatus("VIN must be exactly 17 characters.");
      return;
    }

    setIsDecodingVin(true);
    setVinStatus("Decoding VIN via NHTSA...");

    try {
      const resp = await fetch(
        `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${cleanVin}?format=json`
      );
      const data = await resp.json();
      const result = data?.Results?.[0];

      if (result && result.Make && result.Model && result.ModelYear) {
        setFormData((prev) => ({
          ...prev,
          vehicleYear: result.ModelYear,
          vehicleMake: result.Make,
          vehicleModel: result.Model,
        }));
        setVinStatus(`Auto-filled: ${result.ModelYear} ${result.Make} ${result.Model}`);
      } else {
        setVinStatus("VIN lookup yielded no direct vehicle specs. Please input manually below.");
      }
    } catch (err) {
      setVinStatus("Failed to decode VIN automatically. Please fill fields below manually.");
    } finally {
      setIsDecodingVin(false);
    }
  };

  const handlePhotoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const selectedFiles = Array.from(e.target.files).slice(0, 3);
    setPhotos(selectedFiles);
    setPhotoPreviews(selectedFiles.map((file) => URL.createObjectURL(file)));
  };

  const removePhoto = (indexToRemove: number) => {
    setPhotos((prev) => prev.filter((_, index) => index !== indexToRemove));
    setPhotoPreviews((prev) => prev.filter((_, index) => index !== indexToRemove));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (photos.length === 0) return;

    setIsSubmitting(true);
    setEstimateResult(null);
    setErrorMessage(null);

    try {
      setStatusMessage(`Preparing ${photos.length} photo(s) for AI...`);
      const compressedBase64Images = await Promise.all(
        photos.map((file) => compressImage(file))
      );

      setStatusMessage("Analyzing damage across uploaded photo(s)...");
      const aiResponse = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base64Images: compressedBase64Images,
          make: formData.vehicleMake,
          model: formData.vehicleModel,
          year: formData.vehicleYear,
          description: formData.damageDescription,
          vin: formData.vinNumber,
        }),
      });

      const aiData = await aiResponse.json();

      if (!aiResponse.ok || !aiData.estimate) {
        throw new Error(aiData.error || "Failed to generate estimate.");
      }

      setEstimateResult(aiData.estimate);

      try {
        setStatusMessage("Saving lead details...");
        const uploadedPhotoUrls: string[] = [];

        for (const file of photos) {
          const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "")}`;
          const { error: uploadError } = await supabase.storage
            .from("damage-photos")
            .upload(fileName, file);

          if (!uploadError) {
            const { data } = supabase.storage
              .from("damage-photos")
              .getPublicUrl(fileName);
            uploadedPhotoUrls.push(data.publicUrl);
          }
        }

        await supabase.from("leads").insert([
          {
            customer_name: formData.customerName,
            customer_phone: formData.customerPhone,
            vehicle_year: parseInt(formData.vehicleYear) || 0,
            vehicle_make: formData.vehicleMake,
            vehicle_model: formData.vehicleModel,
            damage_description: formData.damageDescription,
            photo_urls: uploadedPhotoUrls,
          },
        ]);
      } catch (bgError) {
        console.warn("[Background Lead Save Warning]:", bgError);
      }

    } catch (err: any) {
      const parsedError = err?.message || "An unexpected error occurred.";
      console.warn("[Submission Warning]:", parsedError);
      setErrorMessage(parsedError);
    } finally {
      setIsSubmitting(false);
      setStatusMessage("");
    }
  };

  const renderFormattedText = (rawText: string) => {
    return rawText.split("\n").map((line, i) => {
      let trimmed = line.trim();
      if (!trimmed) return null;

      const isBullet = trimmed.startsWith("*") || trimmed.startsWith("-");
      if (isBullet) {
        trimmed = trimmed.substring(1).trim();
      }

      const parts = trimmed.split("**");

      return (
        <div key={i} className={isBullet ? "ml-3 my-1 flex items-start" : "my-2"}>
          {isBullet && <span className="mr-2 text-green-700 font-bold">•</span>}
          <span>
            {parts.map((part, index) =>
              index % 2 === 1 ? (
                <strong key={index} className="font-bold text-gray-900">
                  {part}
                </strong>
              ) : (
                part
              )
            )}
          </span>
        </div>
      );
    });
  };

  return (
    <div className="max-w-xl mx-auto p-4 sm:p-6 bg-white rounded-xl shadow-sm border border-gray-100 mt-10 print:m-0 print:border-none print:shadow-none">
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-bold text-gray-900">Get an Instant Estimate</h2>
        <p className="text-sm text-gray-500 mt-1">Upload 1-3 photos of the damage.</p>
      </div>

      {!estimateResult ? (
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Damage Photos (Max 3)
            </label>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handlePhotoUpload}
              disabled={isSubmitting}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />

            {photoPreviews.length > 0 && (
              <div className="grid grid-cols-3 gap-4 mt-4">
                {photoPreviews.map((preview, index) => (
                  <div key={index} className="relative group aspect-square">
                    <img
                      src={preview}
                      alt="Preview"
                      className="w-full h-full object-cover rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(index)}
                      className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 text-xs font-bold"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-2">
            <div className="flex justify-between items-center">
              <label className="block text-sm font-semibold text-gray-800">
                Vehicle VIN Number <span className="text-xs font-normal text-gray-500">(Optional)</span>
              </label>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                name="vinNumber"
                placeholder="e.g. 1FTFW1E84MK..."
                maxLength={17}
                value={formData.vinNumber}
                onChange={handleInputChange}
                className="flex-1 p-2 border border-gray-300 rounded-lg text-gray-900 uppercase font-medium placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => decodeVin(formData.vinNumber)}
                disabled={isDecodingVin || formData.vinNumber.trim().length !== 17}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold rounded-lg text-sm transition"
              >
                {isDecodingVin ? "Decoding..." : "Auto-Fill"}
              </button>
            </div>
            {vinStatus && (
              <p className="text-xs text-blue-700 font-medium">{vinStatus}</p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
              <input
                required
                type="number"
                name="vehicleYear"
                value={formData.vehicleYear}
                onChange={handleInputChange}
                className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 font-medium placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Make</label>
              <input
                required
                type="text"
                name="vehicleMake"
                value={formData.vehicleMake}
                onChange={handleInputChange}
                className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 font-medium placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
              <input
                required
                type="text"
                name="vehicleModel"
                value={formData.vehicleModel}
                onChange={handleInputChange}
                className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 font-medium placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Damage Description
            </label>
            <textarea
              name="damageDescription"
              value={formData.damageDescription}
              onChange={handleInputChange}
              rows={3}
              className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 font-medium placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                required
                type="text"
                name="customerName"
                value={formData.customerName}
                onChange={handleInputChange}
                className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 font-medium placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                required
                type="tel"
                name="customerPhone"
                value={formData.customerPhone}
                onChange={handleInputChange}
                className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 font-medium placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {errorMessage}
            </div>
          )}

          <div className="space-y-3">
            <button
              type="submit"
              disabled={isSubmitting || photos.length === 0}
              className={`w-full py-3 px-4 text-white font-semibold rounded-lg ${
                isSubmitting || photos.length === 0
                  ? "bg-gray-400"
                  : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {isSubmitting ? statusMessage || "Processing..." : "Submit Estimate Request"}
            </button>

            <p className="text-xs text-gray-400 text-center leading-normal">
              <strong>Official Notice:</strong> Initial estimates are automated, preliminary, and non-binding. Final scope and repair costs are determined following in-person vehicle inspection and shop teardown.
            </p>
          </div>
        </form>
      ) : (
        <div className="bg-green-50 p-6 rounded-xl border border-green-200">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-bold text-green-900">AI Estimate Complete</h3>
            <span className="text-xs bg-green-200 text-green-900 px-2 py-1 rounded-full font-bold">
              {formData.vehicleYear} {formData.vehicleMake} {formData.vehicleModel}
            </span>
          </div>

          <div className="text-gray-800 leading-relaxed">
            {renderFormattedText(estimateResult)}
          </div>

          <div className="mt-6 space-y-3 print:hidden">
            <a
              href={BOOKING_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full text-center py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-sm transition"
            >
              📅 Schedule In-Person Shop Inspection
            </a>

            <button
              onClick={() => window.print()}
              className="w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold rounded-lg border border-gray-300 transition text-sm"
            >
              🖨️ Download / Print Official Estimate Worksheet
            </button>
          </div>

          <div className="mt-6 pt-4 border-t border-green-200">
            <p className="text-xs text-green-800/80 leading-normal mb-4">
              <strong>Please Note:</strong> This photo-based assessment is a preliminary estimate provided for reference purposes only. Final binding costs are subject to in-person shop evaluation, hidden structural inspection, and parts availability.
            </p>

            <button
              onClick={() => {
                setEstimateResult(null);
                setPhotos([]);
                setPhotoPreviews([]);
              }}
              className="w-full py-3 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 font-semibold print:hidden"
            >
              Start New Estimate
            </button>
          </div>
        </div>
      )}
    </div>
  );
}