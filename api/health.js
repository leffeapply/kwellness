export default function handler(_request, response) {
  response.status(200).json({
    service: "promoms-care-api",
    status: "ok",
    database: "supabase",
    timestamp: new Date().toISOString(),
  });
}
