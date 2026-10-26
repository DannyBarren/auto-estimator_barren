# iOS Capture Shell (LiDAR Concept Branch)

Native SwiftUI app that replaces manual form entry with two guided capture passes.

## Pass 1: Video Pull-Back (Localization)

- User holds phone close to the damage, starts a video session, and slowly backs away while moving laterally.
- Captures overlapping frames at multiple distances: damage up close → panel context → full vehicle.
- Apple Vision framework tracks features across frames on-device (VNDetectContoursRequest + VNSequenceRequestHandler) to build a consistent damage region across scales.
- Output: bounding box of damage in normalized image coordinates, panel classification guess, and a confidence score.

## Pass 2: LiDAR Depth Scan (Measurement)

- ARKit session with ARWorldTrackingConfiguration, sceneReconstruction enabled for LiDAR depth.
- User places a finger flat against an undamaged section of the same panel near the damage as a scale anchor (gives absolute mm units without a calibration target).
- ARKit raycasts from the finger touch point into the depth map; the engine samples depth around the anchored point and around the damage region transferred from Pass 1.
- Output: max depth deviation (mm), length, width, approximate volume, surface normal of the panel.

## Combined Output

A `ScanResult` JSON payload sent to the existing `/api/analyze` pipeline:

```json
{
  "vehicle": { "year": 2020, "make": "Honda", "model": "Civic" },
  "damageLocation": "rear_quarter_driver",
  "damageType": "dent",
  "areaSqIn": 12.4,
  "depthMm": 8.2,
  "volumeCc": 31.5,
  "panelNormal": [0.1, 0.2, 0.97],
  "localizationConfidence": 0.87,
  "depthConfidence": 0.74,
  "frames": ["base64://...", "..."],
  "depthMapUrl": "https://..."
}
```

The server-side pipeline (extract → retrieve → synthesize) consumes this instead of asking the user for measurements. Make/model/year remain the only manual fields.

## Requirements

- iPhone 12 Pro or later (LiDAR Scanner)
- iOS 17+
- Xcode 15+
- ARKit, RealityKit optional, Vision, AVFoundation

## File Map

- `CaptureSessionManager.swift` — AVFoundation video session for Pass 1
- `DamageLocalizer.swift` — Vision-based multi-frame damage localization
- `LiDARDepthScanner.swift` — ARKit depth capture + finger scale anchor
- `DepthMeasurementEngine.swift` — depth deviation, dimensions, volume math
- `ScanResult.swift` — structured output model + JSON encoding
- `CaptureView.swift` — SwiftUI two-pass guided UI
- `APIClient.swift` — sends ScanResult to the Next.js backend

## Open Questions

- Glossy paint and curved panels degrade LiDAR depth; finger anchor placement rules need real-world testing.
- Dark garage conditions break Pass 1 frame matching; may need IR-assisted capture or a minimum lux threshold.
- Panel classification from Vision alone is weak; consider feeding extracted frames to Gemini for panel ID as a second opinion.
- Should the depth map be uploaded as a raw file or downsampled to a grid for the server?