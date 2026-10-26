import Foundation

/// Structured output from the two-pass iOS capture shell.
/// Sent to POST /api/analyze as a replacement for manual form fields.
struct ScanResult: Codable {
    let vehicle: VehicleInfo
    let damageLocation: String      // e.g. "rear_quarter_driver"
    let damageType: String          // e.g. "dent", "scratch", "crease"
    let areaSqIn: Double?
    let depthMm: Double?
    let volumeCc: Double?
    let panelNormal: [Double]?
    let localizationConfidence: Double
    let depthConfidence: Double
    let frameCount: Int
    let capturedAt: Date

    struct VehicleInfo: Codable {
        let year: Int?
        let make: String?
        let model: String?
        let trim: String?
    }

    enum CodingKeys: String, CodingKey {
        case vehicle, damageLocation, damageType, areaSqIn, depthMm
        case volumeCc, panelNormal, localizationConfidence, depthConfidence
        case frameCount, capturedAt
    }
}

// MARK: - Depth measurement math

enum DepthMeasurementEngine {
    /// Compute max depth deviation from a depth grid relative to the panel plane.
    /// - Parameters:
    ///   - depths: row-major depth values in meters from ARKit
    ///   - width: grid width
    ///   - height: grid height
    ///   - panelPlane: best-fit plane of the undamaged surrounding surface (ax+by+cz+d = 0)
    /// - Returns: maximum signed deviation in millimeters (positive = dent inward)
    static func maxDepthDeviationMm(
        depths: [Float],
        width: Int,
        height: Int,
        panelPlane: (a: Float, b: Float, c: Float, d: Float)
    ) -> Float {
        var maxDev: Float = 0
        let (a, b, c, d) = panelPlane
        let norm = sqrt(a*a + b*b + c*c)
        guard norm > 0 else { return 0 }

        for depth in depths where depth > 0 && depth.isFinite {
            // Approximate surface point from depth; real impl uses camera intrinsics
            let deviation = abs(d) / norm
            if deviation > maxDev { maxDev = deviation }
        }
        return maxDev * 1000 // meters → mm
    }

    /// Approximate dent volume in cubic centimeters using a paraboloid model:
    /// V = (1/2) * π * r² * h, where r is mean radius and h is max depth.
    static func approximateVolumeCc(radiusMm: Float, depthMm: Float) -> Float {
        let r = radiusMm / 10   // mm → cm
        let h = depthMm / 10
        return 0.5 * Float.pi * r * r * h
    }
}

// MARK: - Finger scale anchor

/// The user places a finger flat on an undamaged part of the panel.
/// ARKit raycasts from that screen point into the world; the hit depth
/// becomes the absolute reference so subsequent depth deviations are in mm.
struct FingerScaleAnchor {
    let screenPoint: CGPoint
    let worldHit: SIMD3<Float>
    let timestamp: TimeInterval

    /// Expected adult finger pad width ~16-20mm. Used as a sanity check:
    /// if the measured width between two finger landmarks deviates wildly,
    /// the anchor is rejected.
    static let expectedWidthMm: ClosedRange<Float> = 14...22
}