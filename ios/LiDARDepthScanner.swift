import ARKit
import RealityKit
import UIKit

/// Pass 2: ARKit LiDAR depth capture with finger scale anchor.
///
/// Flow:
/// 1. Start AR session with scene reconstruction (LiDAR mesh).
/// 2. User taps screen where finger rests on undamaged panel → raycast → FingerScaleAnchor.
/// 3. Engine samples depth in a grid around the anchor and around the
///    damage region transferred from Pass 1 (projected via the AR frame).
/// 4. Panel plane fit on anchor neighborhood; max deviation = dent depth.
final class LiDARDepthScanner: NSObject, ObservableObject, ARSessionDelegate {

    @Published var isSessionRunning = false
    @Published var anchorPlaced = false
    @Published var latestDepthMm: Float = 0
    @Published var statusMessage: String = "Place finger on undamaged panel near damage"

    private let arView = ARSCNView()
    private var fingerAnchor: FingerScaleAnchor?
    private var depthGrid: [Float] = []
    private var gridWidth = 0
    private var gridHeight = 0

    // Transferred from Pass 1
    var damageRectNormalized: CGRect?

    func attach(to view: ARSCNView) {
        arView.delegate = self
        view.delegate = self
    }

    func startSession() {
        guard ARWorldTrackingConfiguration.isSupported else {
            statusMessage = "LiDAR not available on this device"
            return
        }

        let config = ARWorldTrackingConfiguration()
        config.sceneReconstruction = .mesh
        config.environmentTexturing = .automatic
        if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
            config.frameSemantics.insert(.sceneDepth)
        }
        arView.session.run(config, options: [.resetTracking, .removeExistingAnchors])
        isSessionRunning = true
    }

    func stopSession() {
        arView.session.pause()
        isSessionRunning = false
    }

    // MARK: - Finger anchor placement

    func handleTap(at screenPoint: CGPoint) {
        let results = arView.hitTest(screenPoint, types: [.existingPlaneUsingGeometry, .featurePoint])
        guard let hit = results.first else {
            statusMessage = "No surface detected — hold steady and try again"
            return
        }

        fingerAnchor = FingerScaleAnchor(
            screenPoint: screenPoint,
            worldHit: SIMD3<Float>(hit.worldTransform.columns.3.x,
                                    hit.worldTransform.columns.3.y,
                                    hit.worldTransform.columns.3.z),
            timestamp: CACurrentMediaTime()
        )
        anchorPlaced = true
        statusMessage = "Anchor set. Slowly sweep the phone over the damage area."
    }

    // MARK: - ARSessionDelegate

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        guard let anchor = fingerAnchor else { return }

        // Sample scene depth around the anchor's projected screen point
        if let sceneDepth = frame.sceneDepth {
            sampleDepthGrid(
                depthMap: sceneDepth.depthMap,
                confidenceMap: sceneDepth.confidenceMap,
                around: anchor.screenPoint,
                frame: frame
            )
        }
    }

    private func sampleDepthGrid(
        depthMap: CVPixelBuffer,
        confidenceMap: CVPixelBuffer,
        around point: CGPoint,
        frame: ARFrame
    ) {
        CVPixelBufferLockBaseAddress(depthMap, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(depthMap, .readOnly) }

        let width = CVPixelBufferGetWidth(depthMap)
        let height = CVPixelBufferGetHeight(depthMap)
        gridWidth = min(width, 64)
        gridHeight = min(height, 64)

        guard let base = CVPixelBufferGetBaseAddress(depthMap) else { return }
        let ptr = base.assumingMemoryBound(to: Float32.self)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(depthMap) / MemoryLayout<Float32>.size

        // Map screen point to depth-map coordinates
        let scaleX = CGFloat(width) / arView.bounds.width
        let scaleY = CGFloat(height) / arView.bounds.height
        let cx = Int(point.x * scaleX)
        let cy = Int(point.y * scaleY)

        let radius = 16
        var samples: [Float] = []
        for dy in -radius...radius {
            for dx in -radius...radius {
                let x = cx + dx, y = cy + dy
                guard x >= 0, x < width, y >= 0, y < height else { continue }
                let d = ptr[y * bytesPerRow + x]
                if d > 0 && d.isFinite { samples.append(d) }
            }
        }

        depthGrid = samples

        // Fit panel plane from anchor neighborhood, measure max deviation
        if samples.count > 10 {
            let plane = fitPlane(points: samples) // simplified: uses depth values directly
            latestDepthMm = DepthMeasurementEngine.maxDepthDeviationMm(
                depths: samples,
                width: gridWidth,
                height: gridHeight,
                panelPlane: plane
            )
        }
    }

    /// Very simplified plane fit for v0. Real version uses RANSAC on 3D points
    /// reconstructed from depth + camera intrinsics.
    private func fitPlane(points: [Float]) -> (a: Float, b: Float, c: Float, d: Float) {
        let mean = points.reduce(0, +) / Float(points.count)
        // Panel assumed roughly facing camera → normal ≈ (0,0,1), plane at mean depth
        return (0, 0, 1, -mean)
    }

    // MARK: - Build final measurement

    func buildMeasurement() -> (depthMm: Float, volumeCc: Float, confidence: Float) {
        let depth = latestDepthMm
        // Radius estimate: use damage rect width from Pass 1 if available
        let radiusMm: Float
        if let rect = damageRectNormalized {
            radiusMm = Float(rect.width) * 150 // rough: normalized width → mm scale, tuned empirically
        } else {
            radiusMm = 25
        }
        let volume = DepthMeasurementEngine.approximateVolumeCc(radiusMm: radiusMm, depthMm: depth)

        // Confidence: fraction of depth samples that were valid
        let confidence = Float(depthGrid.count) / Float(gridWidth * gridHeight)
        return (depth, volume, min(confidence, 1.0))
    }
}