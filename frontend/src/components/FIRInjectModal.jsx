import { useEffect, useMemo, useState } from "react";
import axios from "axios";

const TIME_SLOTS = ["MORNING", "AFTERNOON", "EVENING", "NIGHT"];

function buildInitialForm() {
  const today = new Date();
  return {
    district: "",
    taluk_id: "",
    category: "Property",
    count: 4,
    year: today.getFullYear(),
    month: today.getMonth() + 1,
    time_slot: "EVENING",
  };
}

export default function FIRInjectModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState(buildInitialForm);
  const [districts, setDistricts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [taluks, setTaluks] = useState([]);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoadingMeta(true);
    setError("");

    Promise.all([
      axios.get("http://localhost:8000/api/fir/districts"),
      axios.get("http://localhost:8000/api/fir/categories"),
    ])
      .then(([districtRes, categoryRes]) => {
        if (cancelled) return;
        const nextDistricts = districtRes.data.districts || [];
        const nextCategories = categoryRes.data.categories || [];
        setDistricts(nextDistricts);
        setCategories(nextCategories);
        setForm((current) => ({
          ...current,
          district: current.district || nextDistricts[0] || "",
          category: nextCategories.includes(current.category)
            ? current.category
            : nextCategories[0] || "Property",
        }));
      })
      .catch(() => {
        if (cancelled) return;
        setError("Unable to load FIR form data.");
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingMeta(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !form.district) {
      setTaluks([]);
      return;
    }

    let cancelled = false;

    axios
      .get("http://localhost:8000/api/fir/taluks", {
        params: { district: form.district },
      })
      .then((response) => {
        if (cancelled) return;
        const nextTaluks = response.data.taluks || [];
        setTaluks(nextTaluks);
        setForm((current) => ({
          ...current,
          taluk_id:
            nextTaluks.some((taluk) => taluk.taluk_id === current.taluk_id)
              ? current.taluk_id
              : nextTaluks[0]?.taluk_id || "",
        }));
      })
      .catch(() => {
        if (cancelled) return;
        setError("Unable to load taluks for the selected district.");
      });

    return () => {
      cancelled = true;
    };
  }, [form.district, open]);

  const selectedTaluk = useMemo(
    () => taluks.find((taluk) => taluk.taluk_id === form.taluk_id) || null,
    [form.taluk_id, taluks],
  );

  const handleChange = (key, value) => {
    setError("");
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleClose = () => {
    setError("");
    setForm(buildInitialForm());
    setTaluks([]);
    onClose();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.district || !form.taluk_id || !form.category) {
      setError("District, taluk, and category are required.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const response = await axios.post("http://localhost:8000/api/fir/demo-entry", {
        district: form.district,
        taluk_id: form.taluk_id,
        category: form.category,
        count: Number(form.count),
        year: Number(form.year),
        month: Number(form.month),
        time_slot: form.time_slot,
      });

      onCreated?.(response.data.entry);
      handleClose();
    } catch (submitError) {
      setError(
        submitError?.response?.data?.message ||
          "Unable to add FIR right now. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-slate-900 text-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.28em] text-cyan-300/80">
              Live FIR Injection
            </p>
            <h2 className="mt-1 text-lg font-bold">Add FIR To Operational Dataset</h2>
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg border border-white/10 px-3 py-1 text-sm text-slate-300 transition hover:bg-white/5 hover:text-white"
          >
            Close
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 px-6 py-5">
          <p className="text-sm text-slate-400">
            This writes a new FIR into the database and refreshes the map-backed views.
          </p>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                District
              </span>
              <select
                value={form.district}
                onChange={(event) => handleChange("district", event.target.value)}
                disabled={loadingMeta || submitting}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"
              >
                {districts.map((district) => (
                  <option key={district} value={district}>
                    {district}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Taluk
              </span>
              <select
                value={form.taluk_id}
                onChange={(event) => handleChange("taluk_id", event.target.value)}
                disabled={!taluks.length || submitting}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"
              >
                {taluks.map((taluk) => (
                  <option key={taluk.taluk_id} value={taluk.taluk_id}>
                    {taluk.taluk}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Crime Category
              </span>
              <select
                value={form.category}
                onChange={(event) => handleChange("category", event.target.value)}
                disabled={loadingMeta || submitting}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"
              >
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Incident Count
              </span>
              <input
                type="number"
                min="1"
                max="25"
                value={form.count}
                onChange={(event) => handleChange("count", event.target.value)}
                disabled={submitting}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Year
              </span>
              <input
                type="number"
                min="2024"
                max="2026"
                value={form.year}
                onChange={(event) => handleChange("year", event.target.value)}
                disabled={submitting}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Month
              </span>
              <input
                type="number"
                min="1"
                max="12"
                value={form.month}
                onChange={(event) => handleChange("month", event.target.value)}
                disabled={submitting}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
              Time Slot
            </span>
            <div className="grid gap-2 sm:grid-cols-4">
              {TIME_SLOTS.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  onClick={() => handleChange("time_slot", slot)}
                  className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                    form.time_slot === slot
                      ? "border-cyan-400 bg-cyan-500/15 text-cyan-200"
                      : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"
                  }`}
                >
                  {slot}
                </button>
              ))}
            </div>
          </label>

          <div className="rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-300">
            <p>
              Target zone:
              <span className="ml-2 font-semibold text-white">
                {selectedTaluk ? `${selectedTaluk.taluk}, ${selectedTaluk.district}` : "Loading..."}
              </span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Police station and legal section are derived automatically from the selected taluk and category.
            </p>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-white/5 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || loadingMeta}
              className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Injecting FIR..." : "Add FIR To Database"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
