import { PITCH_TYPE_KO, PITCH_TYPES } from "@/lib/constants";
import { json } from "@/lib/http";
import { model } from "@/lib/model";
import { pitchers } from "@/lib/pitchers";
import { supabaseConfigured } from "@/lib/supabase";

export async function GET() {
  return json({
    pitchers, pitch_types: PITCH_TYPES.map((t) => ({ id: t, name: PITCH_TYPE_KO[t] })),
    model: { version: model.version, data_source: model.data_source, trained_at: model.trained_at, n_trees: model.n_trees, disclaimer: model.disclaimer },
    storage: { supabase: supabaseConfigured(), persistence_enabled: supabaseConfigured() && !!process.env.UPLOAD_TOKEN },
  });
}
