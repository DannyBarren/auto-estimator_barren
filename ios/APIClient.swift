import Foundation

/// Sends ScanResult JSON to the Next.js backend.
/// Endpoint: POST /api/analyze (extended to accept scan payloads)
final class APIClient {
    static let shared = APIClient()

    private let baseURL: URL = {
        // Point at your deployed Next.js instance
        URL(string: "https://auto-estimator-barren.vercel.app")!
    }()

    struct AnalyzeResponse: Decodable {
        let estimate: String
        let shopCost: Double?
        let consumerPrice: Double?
        let confidence: Double?
        let referenceRowIds: [String]?
    }

    func send(scan: ScanResult) async throws -> AnalyzeResponse {
        let url = baseURL.appendingPathComponent("/api/analyze")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        request.httpBody = try encoder.encode(scan)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw APIError.serverError(status: (response as? HTTPURLResponse)?.statusCode ?? 0, body: body)
        }

        return try JSONDecoder().decode(AnalyzeResponse.self, from: data)
    }

    enum APIError: LocalizedError {
        case serverError(status: Int, body: String)
        var errorDescription: String? {
            switch self {
            case .serverError(let status, let body):
                return "Server returned \(status): \(body.prefix(200))"
            }
        }
    }
}