import { Dashboard } from "@/components/dashboard/Dashboard";
import { model } from "@/lib/model";
import { pitchers } from "@/lib/pitchers";
import metrics from "@/model/metrics.json";
import history from "@/model/training_history.json";
import quality from "@/model/quality_report.json";

export default function Home() {
  return (
    <Dashboard
      pitchers={pitchers}
      modelInfo={{ version: model.version, data_source: model.data_source, trained_at: model.trained_at, n_trees: model.n_trees, disclaimer: model.disclaimer }}
      metrics={metrics as never}
      history={history as never}
      quality={quality as never}
    />
  );
}
