import AVFoundation
import UIKit

/// Manages the Pass 1 video capture: slow pull-back from damage to full vehicle.
/// Delivers CMSampleBuffer frames to DamageLocalizer for multi-scale tracking.
final class CaptureSessionManager: NSObject, ObservableObject {
    @Published var isRunning = false
    @Published var frameCount = 0
    @Published var lastError: String?

    private let session = AVCaptureSession()
    private let videoOutput = AVCaptureVideoDataOutput()
    private let processingQueue = DispatchQueue(label: "com.barren.capture.video")

    var onFrame: ((CMSampleBuffer) -> Void)?

    func start(position: AVCaptureDevice.Position = .back) {
        session.beginConfiguration()
        session.sessionPreset = .hd1920x1080

        guard let device = AVCaptureDevice.default(
            .builtInWideAngleCamera, for: .video, position: position
        ) else {
            lastError = "No wide-angle camera found"
            return
        }

        do {
            let input = try AVCaptureDeviceInput(device: device)
            if session.canAddInput(input) { session.addInput(input) }

            videoOutput.setSampleBufferDelegate(self, queue: processingQueue)
            videoOutput.videoSettings = [
                kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA
            ]
            if session.canAddOutput(videoOutput) { session.addOutput(videoOutput) }

            // Lock focus to near range for the initial close-up frames
            try device.lockForConfiguration()
            device.focusMode = .continuousAutoFocus
            device.exposureMode = .continuousAutoExposure
            device.unlockForConfiguration()
        } catch {
            lastError = error.localizedDescription
            session.commitConfiguration()
            return
        }

        session.commitConfiguration()
        session.startRunning()
        isRunning = true
    }

    func stop() {
        session.stopRunning()
        isRunning = false
    }
}

extension CaptureSessionManager: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        frameCount += 1
        onFrame?(sampleBuffer)
    }
}