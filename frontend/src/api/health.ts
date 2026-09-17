export interface HealthResponse {
  status: "ok";
}

function isHealthResponse(value: unknown): value is HealthResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    value.status === "ok"
  );
}

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch("/api/health/", {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Health check failed with status ${response.status}`);
  }

  const data: unknown = await response.json();
  if (!isHealthResponse(data)) {
    throw new Error("Health check returned an invalid response");
  }

  return data;
}
