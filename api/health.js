export default function handler(_request, response) {
  response.status(200).json({
    service: "k-wellness-careos-api",
    status: "ok",
    database: "supabase",
    timestamp: new Date().toISOString(),
  });
}
