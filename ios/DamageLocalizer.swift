import Vision
import CoreVideo
import CoreMedia

/// Pass 1 processor: tracks the damage region across the pull-back video sequence.
/// Uses VNDetectContoursRequest per frame plus VNSequenceRequestHandler to
/// maintain a consistent damage track as the camera moves from close-up to full car.
final class DamageLocalizer {

    struct LocalizedDamage {
        let normalizedRect: CGRect      // damage bbox in normalized image coords
        let panelGuess: String?         // best-guess panel from contour context
        let confidence: Float
        let frameIndex: Int
        let scaleHint: ScaleHint        // close / mid / full based on frame progression
    }

    enum ScaleHint {
        case closeUp   // first ~30% of frames: damage fills most of frame
        case midRange  // middle: panel context visible
        case fullCar   // last ~30%: whole vehicle in frame
    }

    private let sequenceHandler = VNSequenceRequestHandler()
    private var trackHistory: [LocalizedDamage] = []
    private var frameIndex = 0

    /// Feed each video frame. Returns the latest localization.
    func process(sampleBuffer: CMSampleBuffer) -> LocalizedDamage? {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            return nil
        }

        let request = VNDetectContoursRequest()
        request.contrastAdjustment = 1.5   // dents create shadow/highlight edges
        request.detectsDarkOnLight = true

        do {
            try sequenceHandler.perform([request], on: pixelBuffer)
        } catch {
            return nil
        }

        guard let results = request.results, !results.isEmpty else {
            frameIndex += 1
            return nil
        }

        // Pick the contour cluster with the strongest edge response near frame center-ish
        // (user starts close to damage). Real impl would cluster by spatial proximity.
        let best = results.max(by: { $0.contourCount < $1.contourCount })
        frameIndex += 1

        guard let best else { return nil }

        let bbox = best.boundingBox // Vision coords: origin bottom-left
        let scale: ScaleHint
        switch frameIndex {
        case 0...30: scale = .closeUp
        case 31...70: scale = .midRange
        default: scale = .fullCar
        }

        let localized = LocalizedDamage(
            normalizedRect: bbox,
            panelGuess: nil, // filled by Gemini second-opinion on extracted frames
            confidence: best.confidence,
            frameIndex: frameIndex,
            scaleHint: scale
        )
        trackHistory.append(localized)
        return localized
    }

    /// After the pull-back completes, produce the consensus damage region.
    /// Weights close-up frames higher for precision, full-car frames for panel ID.
    func consensus() -> LocalizedDamage? {
        guard !trackHistory.isEmpty else { return nil }

        let closeUps = trackHistory.filter { $0.scaleHint == .closeUp }
        let mids = trackHistory.filter { $0.scaleHint == .midRange }

        // Median bbox across close-up + mid-range frames for robustness to outliers
        func median(_ vals: [CGFloat]) -> CGFloat {
            let sorted = vals.sorted()
            let mid = sorted.count / 2
            return sorted.isEmpty ? 0 : sorted[mid]
        }

        let pool = closeUps + mids
        guard !pool.isEmpty else { return trackHistory.last }

        let rect = CGRect(
            x: median(pool.map { $0.normalizedRect.minX }),
            y: median(pool.map { $0.normalizedRect.minY }),
            width: median(pool.map { $0.normalizedRect.width }),
            height: median(pool.map { $0.normalizedRect.height })
        )

        let avgConfidence = pool.map { $0.confidence }.reduce(0, +) / Float(pool.count)

        return LocalizedDamage(
            normalizedRect: rect,
            panelGuess: nil,
            confidence: avgConfidence,
            frameIndex: frameIndex,
            scaleHint: .midRange
        )
    }

    func reset() {
        trackHistory.removeAll()
        frameIndex = 0
        try? sequenceHandler.cancelPreviousPerformRequests()
    }
}