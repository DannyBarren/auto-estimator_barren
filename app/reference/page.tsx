"use client";

import React, { useState, ChangeEvent, FormEvent } from "react";
import Link from "next/link";

type Tab = "csv" | "manual";

const EMPTY_MANUAL = {
  source_type: "manual_entry",
  vehicle_year: "",
  vehicle_make: "",
  vehicle_model: "",
  vehicle_trim: "",
  vehicle_body_style: "",
  paint_type: "",
  paint_color: "",
  paint_code: "",
  damage_location: "",
  damage_type: "",
  damage_severity: "",
  damage_notes: "",
  materials_cost: "",
  labor_hours: "",
  labor_rate: "",
  labor_cost: "",
  other_cost: "",
  total_shop_cost: "",
  estimated_customer_price: "",
  final_invoice_total: "",
  confidence: "0.8",
};

export default function ReferenceDataPage() {
  const [tab, setTab] = useState<Tab>("csv");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [csvResult, setCsvResult] = useState<string | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);

  const [manual, setManual] = useState({ ...EMPTY_MANUAL });
  const [isSaving, setIsSaving] = useState(false);
  const [manualResult, setManualResult] = useState<string | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);

  const handleCsvChange = (e: ChangeEvent<HTMLInputElement>) => {
    setCsvFile(e.target.files?.[0] ?? null);
    setCsvResult(null);
    setCsvError(null);
  };

  const handleCsvUpload = async (e: FormEvent) => {
    e.preventDefault();
    if (!csvFile) return;

    setIsUploading(true);
    setCsvResult(null);
    setCsvError(null);

    try {
      const fd = new FormData();
      fd.append("file", csvFile);

      const res = await fetch("/api/reference/upload", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Upload failed.");
      }

      setCsvResult(
        `Inserted ${data.inserted} row(s)${data.skipped ? `, skipped ${data.skipped}` : ""}.`
      );
      if (data.errors?.length) {
        setCsvError(data.errors.join(" "));
      }
      setCsvFile(null);
    } catch (err: unknown) {
      setCsvError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleManualChange = (
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setManual((prev) => ({ ...prev, [name]: value }));
  };

  const handleManualSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setManualResult(null);
    setManualError(null);

    try {
      const res = await fetch("/api/reference/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(manual),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Save failed.");
      }

      setManualResult(`Record saved (id: ${data.id}).`);
      setManual({ ...EMPTY_MANUAL });
    } catch (err: unknown) {
      setManualError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reference Data</h1>
          <p className="text-sm text-gray-500 mt-1">
            Feed the grounding database with shop invoices and historical jobs.
          </p>
        </div>
        <Link
          href="/"
          className="text-sm text-blue-600 hover:text-blue-700 font-medium"
        >
          ← Back to estimator
        </Link>
      </div>

      <div className="flex border-b border-gray-200 mb-6">
        <button
          type="button"
          onClick={() => setTab("csv")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition ${{
            tab === "csv"
              ? "border-blue-600 text-blue-700"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }}`}
        >
          CSV Upload
        </button>
        <button
          type="button"
          onClick={() => setTab("manual")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition ${{
            tab === "manual"
              ? "border-blue-600 text-blue-700"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }}`}
        >
          Manual Entry
        </button>
      </div>

      {tab === "csv" && (
        <div className="space-y-6">
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-900">
            <p className="font-medium mb-1">CSV format</p>
            <p className="text-blue-800/80">
              Download the template below, fill in your shop's closed jobs with
              actual materials and labor costs (not customer prices), and upload.
              Unknown columns are ignored. Empty rows are skipped.
            </p>
            <a
              href="/reference_estimates_template.csv"
              download
              className="inline-block mt-2 text-blue-700 font-semibold underline"
            >
              Download CSV template
            </a>
          </div>

          <form onSubmit={handleCsvUpload} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Select CSV file
              </label>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleCsvChange}
                disabled={isUploading}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
            </div>

            {csvError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {csvError}
              </div>
            )}
            {csvResult && (
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">
                {csvResult}
              </div>
            )}

            <button
              type="submit"
              disabled={isUploading || !csvFile}
              className={`w-full py-3 px-4 text-white font-semibold rounded-lg ${{
                isUploading || !csvFile
                  ? "bg-gray-400"
                  : "bg-blue-600 hover:bg-blue-700"
              }}`}
            >
              {isUploading ? "Uploading..." : "Upload & Import"}
            </button>
          </form>
        </div>
      )}

      {tab === "manual" && (
        <form onSubmit={handleManualSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Source Type
              </label>
              <select
                name="source_type"
                value={manual.source_type}
                onChange={handleManualChange}
                className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="manual_entry">Manual Entry</option>
                <option value="shop_invoice">Shop Invoice</option>
                <option value="imported">Imported</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Year
              </label>
              <input
                type="number"
                name="vehicle_year"
                value={manual.vehicle_year}
                onChange={handleManualChange}
                className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Make
              </label>
              <input
                type="text"
                name="vehicle_make"
                value={manual.vehicle_make}
                onChange={handleManualChange}
                className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Model
              </label>
              <input
                type="text"
                name="vehicle_model"
                value={manual.vehicle_model}
                onChange={handleManualChange}
                className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Trim
              </label>
              <input
                type="text"
                name="vehicle_trim"
                value={manual.vehicle_trim}
                onChange={handleManualChange}
                className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Body Style
              </label>
              <input
                type="text"
                name="vehicle_body_style"
                value={manual.vehicle_body_style}
                onChange={handleManualChange}
                placeholder="sedan, truck, suv..."
                className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Paint Type
              </label>
              <input
                type="text"
                name="paint_type"
                value={manual.paint_type}
                onChange={handleManualChange}
                placeholder="solid, metallic, pearl, matte, wrap..."
                className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Paint Color
              </label>
              <input
                type="text"
                name="paint_color"
                value={manual.paint_color}
                onChange={handleManualChange}
                className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Paint Code
              </label>
              <input
                type="text"
                name="paint_code"
                value={manual.paint_code}
                onChange={handleManualChange}
                className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Damage Location
              </label>
              <input
                type="text"
                name="damage_location"
                value={manual.damage_location}
                onChange={handleManualChange}
                placeholder="front bumper, driver door..."
                className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Damage Type
              </label>
              <input
                type="text"
                name="damage_type"
                value={manual.damage_type}
                onChange={handleManualChange}
                placeholder="dent, scratch, crease..."
                className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Severity
              </label>
              <select
                name="damage_severity"
                value={manual.damage_severity}
                onChange={handleManualChange}
                className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">—</option>
                <option value="minor">Minor</option>
                <option value="moderate">Moderate</option>
                <option value="severe">Severe</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Damage Notes
            </label>
            <textarea
              name="damage_notes"
              value={manual.damage_notes}
              onChange={handleManualChange}
              rows={2}
              className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Materials $
              </label>
              <input
                type="number"
                step="0.01"
                name="materials_cost"
                value={manual.materials_cost}
                onChange={handleManualChange}
                className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Labor Hours
              </label>
              <input
                type="number"
                step="0.25"
                name="labor_hours"
                value={manual.labor_hours}
                onChange={handleManualChange}
                className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Labor Rate $/hr
              </label>
              <input
                type="number"
                step="0.01"
                name="labor_rate"
                value={manual.labor_rate}
                onChange={handleManualChange}
                className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Labor Cost $
              </label>
              <input
                type="number"
                step="0.01"
                name="labor_cost"
                value={manual.labor_cost}
                onChange={handleManualChange}
                className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Other Cost $
              </label>
              <input
                type="number"
                step="0.01"
                name="other_cost"
                value={manual.other_cost}
                onChange={handleManualChange}
                className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Total Shop Cost $
              </label>
              <input
                type="number"
                step="0.01"
                name="total_shop_cost"
                value={manual.total_shop_cost}
                onChange={handleManualChange}
                className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Est. Customer Price $
              </label>
              <input
                type="number"
                step="0.01"
                name="estimated_customer_price"
                value={manual.estimated_customer_price}
                onChange={handleManualChange}
                className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Final Invoice Total $
              </label>
              <input
                type="number"
                step="0.01"
                name="final_invoice_total"
                value={manual.final_invoice_total}
                onChange={handleManualChange}
                className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="max-w-xs">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confidence (0–1)
            </label>
            <input
              type="number"
              step="0.05"
              min="0"
              max="1"
              name="confidence"
              value={manual.confidence}
              onChange={handleManualChange}
              className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {manualError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {manualError}
            </div>
          )}
          {manualResult && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">
              {manualResult}
            </div>
          )}

          <button
            type="submit"
            disabled={isSaving}
            className={`w-full py-3 px-4 text-white font-semibold rounded-lg ${{
              isSaving ? "bg-gray-400" : "bg-blue-600 hover:bg-blue-700"
            }}`}
          >
            {isSaving ? "Saving..." : "Save Record"}
          </button>
        </form>
      )}
    </div>
  );
}