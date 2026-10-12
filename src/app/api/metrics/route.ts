import { json } from "@/lib/http";
import history from "@/model/training_history.json";
import metrics from "@/model/metrics.json";
import quality from "@/model/quality_report.json";

export async function GET() {
  return json({ metrics, history, quality });
}
