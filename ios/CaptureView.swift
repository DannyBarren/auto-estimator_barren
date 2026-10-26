import SwiftUI
import ARKit

/// Two-pass guided capture UI.
/// Pass 1: video pull-back with live contour overlay.
/// Pass 2: LiDAR depth scan with finger-anchor instruction.
struct CaptureView: View {
    @StateObject private var videoManager = CaptureSessionManager()
    @StateObject private var lidarScanner = LiDARDepthScanner()
    @StateObject private var localizer = DamageLocalizer()

    @State private var phase: Phase = .instructions
    @State private var vehicleYear = ""
    @State private var vehicleMake = ""
    @State private var vehicleModel = ""
    @State private var scanResult: ScanResult?
    @State private var isSubmitting = false

    enum Phase {
        case instructions
        case videoPass
        case lidarPass
        case review
        case submitting
    }

    var body: some View {
        ZStack {
            switch phase {
            case .instructions:
                instructionsView
            case .videoPass:
                videoPassView
            case .lidarPass:
                lidarPassView
            case .review:
                reviewView
            case .submitting:
                ProgressView("Sending scan...")
            }
        }
        .onAppear { videoManager.onFrame = { localizer.process(sampleBuffer: $0) } }
    }

    // MARK: - Instructions

    private var instructionsView: some View {
        VStack(spacing: 24) {
            Text("Damage Scan").font(.largeTitle.bold())

            TextField("Year", text: $vehicleYear).textFieldStyle(.roundedBorder)
            TextField("Make", text: $vehicleMake).textFieldStyle(.roundedBorder)
            TextField("Model", text: $vehicleModel).textFieldStyle(.roundedBorder)

            Group {
                Label("Pass 1: Hold the phone close to the damage, then slowly back away in a smooth arc until the whole car is in frame. Keep the damage in view the whole time.", systemImage: "video")
                Label("Pass 2: After the video, tap where your finger rests flat on an undamaged part of the same panel. Then sweep slowly over the dent.", systemImage: "arkit")
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)

            Button("Start Pass 1") { phase = .videoPass; videoManager.start() }
                .buttonStyle(.borderedProminent)
                .disabled(vehicleMake.isEmpty || vehicleModel.isEmpty)
        }
        .padding()
    }

    // MARK: - Pass 1: Video

    private var videoPassView: some View {
        VStack {
            ARSCNViewRepresentable(scanner: lidarScanner) // placeholder; real impl swaps to plain camera preview
                .ignoresSafeArea()

            VStack {
                Text("Pass 1 of 2 — Pull back slowly")
                    .font(.headline)
                Text("Frames: \(videoManager.frameCount)")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if videoManager.frameCount > 90 {
                    Button("Done — Start Pass 2") {
                        videoManager.stop()
                        lidarScanner.damageRectNormalized = localizer.consensus()?.normalizedRect
                        phase = .lidarPass
                        lidarScanner.startSession()
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .padding()
            .background(.ultraThinMaterial)
        }
    }

    // MARK: - Pass 2: LiDAR

    private var lidarPassView: some View {
        VStack {
            ARSCNViewRepresentable(scanner: lidarScanner)
                .ignoresSafeArea()
                .onTapGesture { location in
                    lidarScanner.handleTap(at: location)
                }

            VStack {
                Text(lidarScanner.statusMessage)
                    .font(.subheadline)
                    .multilineTextAlignment(.center)

                if lidarScanner.anchorPlaced {
                    Text("Depth: \(String(format: "%.1f", lidarScanner.latestDepthMm)) mm")
                        .font(.title2.monospacedDigit())

                    Button("Capture Measurement") {
                        lidarScanner.stopSession()
                        buildAndReview()
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .padding()
            .background(.ultraThinMaterial)
        }
    }

    // MARK: - Review + submit

    private var reviewView: some View {
        VStack(spacing: 16) {
            Text("Scan Complete").font(.largeTitle.bold())

            if let r = scanResult {
                Group {
                    Text("\(r.vehicle.year.map(String.init) ?? "?") \(r.vehicle.make ?? "") \(r.vehicle.model ?? "")")
                    Text("Location: \(r.damageLocation)")
                    Text("Type: \(r.damageType)")
                    if let d = r.depthMm { Text("Depth: \(String(format: "%.1f", d)) mm") }
                    if let a = r.areaSqIn { Text("Area: \(String(format: "%.1f", a)) sq in") }
                    Text("Localization confidence: \(String(format: "%.0f%%", r.localizationConfidence * 100))")
                    Text("Depth confidence: \(String(format: "%.0f%%", r.depthConfidence * 100))")
                }
                .font(.body.monospacedDigit())
            }

            Button("Submit to Estimator") { submit() }
                .buttonStyle(.borderedProminent)
                .disabled(isSubmitting)

            Button("Retake") {
                localizer.reset()
                phase = .instructions
            }
        }
        .padding()
    }

    // MARK: - Logic

    private func buildAndReview() {
        let measurement = lidarScanner.buildMeasurement()
        let consensus = localizer.consensus()

        scanResult = ScanResult(
            vehicle: .init(
                year: Int(vehicleYear),
                make: vehicleMake,
                model: vehicleModel,
                trim: nil
            ),
            damageLocation: "unknown", // server-side Gemini fills from frames
            damageType: "unknown",
            areaSqIn: nil,
            depthMm: Double(measurement.depthMm),
            volumeCc: Double(measurement.volumeCc),
            panelNormal: nil,
            localizationConfidence: Double(consensus?.confidence ?? 0),
            depthConfidence: Double(measurement.confidence),
            frameCount: videoManager.frameCount,
            capturedAt: Date()
        )
        phase = .review
    }

    private func submit() {
        guard let scanResult else { return }
        isSubmitting = true
        phase = .submitting
        Task {
            do {
                _ = try await APIClient.shared.send(scan: scanResult)
                // transition to result display (wired to existing estimate UI)
            } catch {
                // surface error
            }
            isSubmitting = false
        }
    }
}

// MARK: - ARView wrapper

struct ARSCNViewRepresentable: UIViewRepresentable {
    let scanner: LiDARDepthScanner

    func makeUIView(context: Context) -> ARSCNView {
        let view = ARSCNView()
        scanner.attach(to: view)
        return view
    }

    func updateUIView(_ uiView: ARSCNView, context: Context) {
        // no-op; session lifecycle handled by scanner
    }
}