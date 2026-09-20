import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Ban,
  BadgeCheck,
  Calculator,
  Download,
  Eye,
  Pencil,
  Plus,
  Printer,
  Settings2,
  Trash2,
  UserPlus,
  Wallet,
} from "lucide-react";
import api, { formatMoney } from "../api/client";
import Modal from "../components/Modal";
import { useAuth } from "../context/AuthContext";
import { useCompany } from "../context/CompanyContext";
import { exportCsv, stampedName } from "../lib/exportCsv";
import {
  MONTHS,
  PAYSLIP_STYLE,
  payslipSheet,
  printPayslips,
  type PayslipDocument,
} from "../lib/payslip";

/**
 * Payroll: the workers of the shop, their monthly pay and their payslips.
 *
 * Nothing legal is written in the code: the bonuses and the deductions come
 * from the rules the administrator sets in « Paramètres », and each payslip
 * keeps the lines it was computed with, so a rule changed next year leaves
 * the payslips already signed exactly as they were.
 */

interface Employee {
  id: number;
  matricule: string;
  last_name: string;
  first_name: string;
  full_name: string;
  gender: string;
  birth_date: string | null;
  phone: string;
  address: string;
  job: string;
  department: string;
  hired_at: string | null;
  contract: string;
  status: string;
  base_salary: number;
  payment_method: string;
  bank: string;
  account_number: string;
  social_number: string;
  email: string;
  note: string;
  is_active: boolean;
}

interface Line {
  kind: string;
  label: string;
  quantity: number;
  rate: number;
  base: number;
  amount: number;
  element_id?: number | null;
}

interface Payslip extends PayslipDocument {
  id: number;
  employee_id: number;
  base_salary: number;
  absence_days: number;
  overtime_hours: number;
  overtime_rate: number;
  validated_at: string | null;
  note: string;
  cancel_reason: string;
  lines: Line[];
}

interface Element {
  id: number;
  name: string;
  kind: string;
  mode: string;
  value: number;
  base: string;
  ceiling: number;
  automatic: boolean;
  is_active: boolean;
  starts_on: string | null;
  ends_on: string | null;
  position: number;
}

interface Recap {
  year: number;
  month: number;
  employees: number;
  base_total: number;
  gains_total: number;
  gross_total: number;
  deductions_total: number;
  net_total: number;
  rows: {
    matricule: string;
    employee: string;
    job: string;
    gross: number;
    deductions: number;
    net: number;
    status: string;
  }[];
}

type Tab = "travailleurs" | "paie" | "historique" | "recap" | "parametres";

const CONTRACTS = ["CDI", "CDD", "Stage", "Intérim", "Autre"];
const METHODS = ["Espèces", "Virement", "Mobile Money", "Chèque"];
const STATUSES = ["Brouillon", "Validée", "Payée", "Annulée"];

const EMPTY_EMPLOYEE = {
  matricule: "",
  last_name: "",
  first_name: "",
  gender: "",
  birth_date: "",
  phone: "",
  address: "",
  job: "",
  department: "",
  hired_at: "",
  contract: "CDI",
  status: "En poste",
  base_salary: 0,
  payment_method: "Espèces",
  bank: "",
  account_number: "",
  social_number: "",
  email: "",
  note: "",
  is_active: true,
};

const EMPTY_ELEMENT = {
  name: "",
  kind: "gain",
  mode: "fixe",
  value: 0,
  base: "base",
  ceiling: 0,
  automatic: true,
  is_active: true,
  starts_on: "",
  ends_on: "",
  position: 0,
};

function message(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string") return detail;
  }
  return fallback;
}

function badge(status: string): string {
  if (status === "Payée") return "bg-emerald-100 text-emerald-700";
  if (status === "Validée") return "bg-blue-100 text-blue-700";
  if (status === "Annulée") return "bg-red-100 text-red-700";
  return "bg-slate-100 text-slate-600";
}

export default function Paie() {
  const { can } = useAuth();
  const { company } = useCompany();
  const today = new Date();

  const [tab, setTab] = useState<Tab>("travailleurs");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [employeeForm, setEmployeeForm] = useState({ ...EMPTY_EMPLOYEE });
  const [editing, setEditing] = useState<Employee | null>(null);
  const [employeeOpen, setEmployeeOpen] = useState(false);

  const [elements, setElements] = useState<Element[]>([]);
  const [elementForm, setElementForm] = useState({ ...EMPTY_ELEMENT });
  const [elementEditing, setElementEditing] = useState<Element | null>(null);
  const [elementOpen, setElementOpen] = useState(false);

  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [workerId, setWorkerId] = useState(0);
  const [absence, setAbsence] = useState(0);
  const [hours, setHours] = useState(0);
  const [hourRate, setHourRate] = useState(0);
  const [method, setMethod] = useState("Espèces");
  const [note, setNote] = useState("");
  const [extras, setExtras] = useState<Line[]>([]);
  const [draft, setDraft] = useState<{
    gross: number;
    deductions: number;
    net: number;
    net_in_words: string;
    lines: Line[];
  } | null>(null);
  const [editingSlip, setEditingSlip] = useState<Payslip | null>(null);

  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [historySearch, setHistorySearch] = useState("");
  const [historyYear, setHistoryYear] = useState(today.getFullYear());
  const [historyMonth, setHistoryMonth] = useState(0);
  const [historyStatus, setHistoryStatus] = useState("");
  const [historyDepartment, setHistoryDepartment] = useState("");
  const [picked, setPicked] = useState<number[]>([]);

  const [recap, setRecap] = useState<Recap | null>(null);
  const [preview, setPreview] = useState<Payslip | null>(null);
  const [cancelling, setCancelling] = useState<Payslip | null>(null);
  const [reason, setReason] = useState("");

  const loadEmployees = useCallback(async () => {
    const { data } = await api.get<Employee[]>("/payroll/employees", {
      params: { search, active: showArchived ? "" : "oui" },
    });
    setEmployees(data);
  }, [search, showArchived]);

  const loadHistory = useCallback(async () => {
    const { data } = await api.get<Payslip[]>("/payroll/payslips", {
      params: {
        year: historyYear,
        month: historyMonth,
        status: historyStatus,
        department: historyDepartment,
        search: historySearch,
      },
    });
    setPayslips(data);
  }, [historyYear, historyMonth, historyStatus, historyDepartment, historySearch]);

  const loadRecap = useCallback(async () => {
    const { data } = await api.get<Recap>("/payroll/recap", {
      params: { year, month },
    });
    setRecap(data);
  }, [year, month]);

  useEffect(() => {
    loadEmployees().catch(() => setError("Chargement des travailleurs impossible"));
  }, [loadEmployees]);

  useEffect(() => {
    api
      .get<Element[]>("/payroll/elements")
      .then(({ data }) => setElements(data))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (tab === "historique") loadHistory().catch(() => undefined);
    if (tab === "recap") loadRecap().catch(() => undefined);
  }, [tab, loadHistory, loadRecap]);

  const worker = useMemo(
    () => employees.find((row) => row.id === workerId) ?? null,
    [employees, workerId]
  );

  const departments = useMemo(
    () =>
      Array.from(
        new Set(employees.map((row) => row.department).filter(Boolean))
      ).sort(),
    [employees]
  );

  /** Computes the payslip on the server, with the rules of that month. */
  const computeDraft = useCallback(async () => {
    if (!workerId) return;
    setError("");
    try {
      const { data } = await api.post("/payroll/payslips/preparer", {
        employee_id: workerId,
        year,
        month,
        absence_days: absence,
        overtime_hours: hours,
        overtime_rate: hourRate,
        extra_lines: extras,
      });
      setDraft(data);
    } catch (err) {
      setError(message(err, "Calcul impossible"));
    }
  }, [workerId, year, month, absence, hours, hourRate, extras]);

  useEffect(() => {
    if (tab === "paie") computeDraft();
  }, [tab, computeDraft]);

  /** Opens « Nouvelle paie » already filled for that worker: one click. */
  function startPayroll(row: Employee) {
    setWorkerId(row.id);
    setMethod(row.payment_method || "Espèces");
    setHourRate(Math.round((row.base_salary || 0) / 173.33));
    setAbsence(0);
    setHours(0);
    setExtras([]);
    setNote("");
    setEditingSlip(null);
    setDraft(null);
    setTab("paie");
  }

  async function saveEmployee() {
    setError("");
    try {
      const body = {
        ...employeeForm,
        base_salary: Number(employeeForm.base_salary) || 0,
        birth_date: employeeForm.birth_date || null,
        hired_at: employeeForm.hired_at || null,
      };
      if (editing) await api.put(`/payroll/employees/${editing.id}`, body);
      else await api.post("/payroll/employees", body);
      setEmployeeOpen(false);
      setEditing(null);
      setEmployeeForm({ ...EMPTY_EMPLOYEE });
      await loadEmployees();
      setNotice("Travailleur enregistré");
    } catch (err) {
      setError(message(err, "Enregistrement impossible"));
    }
  }

  async function toggleEmployee(row: Employee) {
    setError("");
    try {
      await api.put(`/payroll/employees/${row.id}`, {
        ...row,
        is_active: !row.is_active,
      });
      await loadEmployees();
    } catch (err) {
      setError(message(err, "Modification impossible"));
    }
  }

  async function removeEmployee(row: Employee) {
    if (!window.confirm(`Supprimer ${row.full_name} ?`)) return;
    setError("");
    try {
      await api.delete(`/payroll/employees/${row.id}`);
      await loadEmployees();
    } catch (err) {
      setError(message(err, "Suppression impossible"));
    }
  }

  async function savePayslip(andValidate: boolean) {
    setError("");
    try {
      const body = {
        employee_id: workerId,
        year,
        month,
        absence_days: absence,
        overtime_hours: hours,
        overtime_rate: hourRate,
        payment_method: method,
        note,
        extra_lines: extras,
        lines: draft?.lines ?? null,
      };
      const { data } = editingSlip
        ? await api.put<Payslip>(`/payroll/payslips/${editingSlip.id}`, body)
        : await api.post<Payslip>("/payroll/payslips", body);
      let saved = data;
      if (andValidate) {
        const answer = await api.post<Payslip>(
          `/payroll/payslips/${data.id}/valider`
        );
        saved = answer.data;
      }
      setEditingSlip(null);
      setNotice(`Bulletin ${saved.reference} enregistré`);
      setPreview(saved);
      await loadHistory();
    } catch (err) {
      setError(message(err, "Enregistrement impossible"));
    }
  }

  async function act(slip: Payslip, action: string) {
    setError("");
    try {
      await api.post(`/payroll/payslips/${slip.id}/${action}`);
      await loadHistory();
      setNotice("Bulletin mis à jour");
    } catch (err) {
      setError(message(err, "Opération impossible"));
    }
  }

  async function confirmCancel() {
    if (!cancelling) return;
    setError("");
    try {
      await api.post(`/payroll/payslips/${cancelling.id}/annuler`, { reason });
      setCancelling(null);
      setReason("");
      await loadHistory();
    } catch (err) {
      setError(message(err, "Annulation impossible"));
    }
  }

  /** Reopens a payslip: same worker, same elements, next month. */
  function duplicate(slip: Payslip) {
    const next = slip.month === 12 ? 1 : slip.month + 1;
    setWorkerId(slip.employee_id);
    setYear(slip.month === 12 ? slip.year + 1 : slip.year);
    setMonth(next);
    setAbsence(0);
    setHours(slip.overtime_hours);
    setHourRate(slip.overtime_rate);
    setMethod(slip.payment_method || "Espèces");
    setExtras([]);
    setEditingSlip(null);
    setTab("paie");
  }

  function editSlip(slip: Payslip) {
    setEditingSlip(slip);
    setWorkerId(slip.employee_id);
    setYear(slip.year);
    setMonth(slip.month);
    setAbsence(slip.absence_days);
    setHours(slip.overtime_hours);
    setHourRate(slip.overtime_rate);
    setMethod(slip.payment_method || "Espèces");
    setNote(slip.note);
    setExtras([]);
    setDraft({
      gross: slip.gross,
      deductions: slip.deductions,
      net: slip.net,
      net_in_words: slip.net_in_words,
      lines: slip.lines,
    });
    setTab("paie");
  }

  async function saveElement() {
    setError("");
    try {
      const body = {
        ...elementForm,
        value: Number(elementForm.value) || 0,
        ceiling: Number(elementForm.ceiling) || 0,
        starts_on: elementForm.starts_on || null,
        ends_on: elementForm.ends_on || null,
      };
      if (elementEditing)
        await api.put(`/payroll/elements/${elementEditing.id}`, body);
      else await api.post("/payroll/elements", body);
      const { data } = await api.get<Element[]>("/payroll/elements");
      setElements(data);
      setElementOpen(false);
      setElementEditing(null);
      setElementForm({ ...EMPTY_ELEMENT });
    } catch (err) {
      setError(message(err, "Enregistrement impossible"));
    }
  }

  async function removeElement(row: Element) {
    if (!window.confirm(`Supprimer « ${row.name} » ?`)) return;
    try {
      await api.delete(`/payroll/elements/${row.id}`);
      setElements(elements.filter((item) => item.id !== row.id));
    } catch (err) {
      setError(message(err, "Suppression impossible"));
    }
  }

  function printSelection() {
    const chosen = payslips.filter((slip) => picked.includes(slip.id));
    printPayslips(chosen.length ? chosen : payslips, company);
  }

  function exportRecap() {
    if (!recap) return;
    exportCsv(
      stampedName(`paie-${recap.year}-${String(recap.month).padStart(2, "0")}`),
      ["Matricule", "Travailleur", "Fonction", "Brut", "Retenues", "Net"],
      recap.rows.map((row) => [
        row.matricule,
        row.employee,
        row.job,
        row.gross,
        row.deductions,
        row.net,
      ])
    );
  }

  function printRecap() {
    if (!recap) return;
    const head =
      `<div class="sheet"><h2 class="title">État récapitulatif de la paie` +
      `</h2><p class="period">${MONTHS[recap.month - 1]} ${recap.year}</p>`;
    const body =
      `<table><thead><tr><th>Matricule</th><th>Travailleur</th>` +
      `<th class="num">Brut</th><th class="num">Retenues</th>` +
      `<th class="num">Net</th></tr></thead><tbody>` +
      recap.rows
        .map(
          (row) =>
            `<tr><td>${row.matricule}</td><td>${row.employee}</td>` +
            `<td class="num">${formatMoney(row.gross)}</td>` +
            `<td class="num">${formatMoney(row.deductions)}</td>` +
            `<td class="num">${formatMoney(row.net)}</td></tr>`
        )
        .join("") +
      `<tr class="total"><td colspan="2">${recap.employees} travailleur(s)` +
      `</td><td class="num">${formatMoney(recap.gross_total)}</td>` +
      `<td class="num">${formatMoney(recap.deductions_total)}</td>` +
      `<td class="num">${formatMoney(recap.net_total)}</td></tr>` +
      `</tbody></table></div>`;
    printPayslipsHtml(head + body);
  }

  /** Prints any payroll sheet with the payslip stylesheet. */
  function printPayslipsHtml(html: string) {
    const win = document.createElement("iframe");
    win.style.cssText =
      "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    win.srcdoc =
      `<html><head><title>État de paie</title>` +
      `<style>${PAYSLIP_STYLE}</style></head><body>${html}</body></html>`;
    win.onload = () => {
      win.contentWindow?.focus();
      win.contentWindow?.print();
      window.setTimeout(() => win.remove(), 1000);
    };
    document.body.appendChild(win);
  }

  const TABS: [Tab, string][] = [
    ["travailleurs", "Travailleurs"],
    ["paie", "Nouvelle paie"],
    ["historique", "Historique"],
    ["recap", "État récapitulatif"],
    ["parametres", "Paramètres de paie"],
  ];

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <div className="flex flex-wrap rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          {TABS.map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`rounded-md px-3 py-1 text-sm ${
                tab === value
                  ? "bg-white font-semibold shadow dark:bg-slate-700"
                  : "text-slate-600 dark:text-slate-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "travailleurs" && can("paie_travailleurs") && (
          <button
            className="btn-primary ml-auto"
            onClick={() => {
              setEditing(null);
              setEmployeeForm({ ...EMPTY_EMPLOYEE });
              setEmployeeOpen(true);
            }}
          >
            <UserPlus size={16} /> Nouveau travailleur
          </button>
        )}
        {tab === "parametres" && can("paie_parametres") && (
          <button
            className="btn-primary ml-auto"
            onClick={() => {
              setElementEditing(null);
              setElementForm({ ...EMPTY_ELEMENT });
              setElementOpen(true);
            }}
          >
            <Plus size={16} /> Nouvel élément
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          {notice}
        </div>
      )}

      {tab === "travailleurs" && (
        <div className="card p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              className="input w-64"
              placeholder="Nom, prénoms ou matricule"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              Afficher les travailleurs archivés
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-2">Matricule</th>
                  <th>Travailleur</th>
                  <th>Fonction</th>
                  <th>Service</th>
                  <th>Contrat</th>
                  <th className="text-right">Salaire de base</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t border-slate-100 dark:border-slate-700"
                  >
                    <td className="py-2 font-mono text-xs">{row.matricule}</td>
                    <td className="font-medium">
                      {row.full_name}
                      {!row.is_active && (
                        <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                          archivé
                        </span>
                      )}
                    </td>
                    <td>{row.job || "—"}</td>
                    <td>{row.department || "—"}</td>
                    <td>{row.contract}</td>
                    <td className="text-right">{formatMoney(row.base_salary)}</td>
                    <td className="py-2">
                      <div className="flex justify-end gap-1">
                        {row.is_active && can("paie_gerer") && (
                          <button
                            className="btn-ghost"
                            title="Préparer la paie"
                            onClick={() => startPayroll(row)}
                          >
                            <Wallet size={16} /> Payer
                          </button>
                        )}
                        {can("paie_travailleurs") && (
                          <>
                            <button
                              className="btn-ghost"
                              title="Modifier"
                              onClick={() => {
                                setEditing(row);
                                setEmployeeForm({
                                  ...EMPTY_EMPLOYEE,
                                  ...row,
                                  birth_date: row.birth_date?.slice(0, 10) ?? "",
                                  hired_at: row.hired_at?.slice(0, 10) ?? "",
                                });
                                setEmployeeOpen(true);
                              }}
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              className="btn-ghost"
                              title={row.is_active ? "Archiver" : "Réactiver"}
                              onClick={() => toggleEmployee(row)}
                            >
                              <Ban size={16} />
                            </button>
                            <button
                              className="btn-ghost text-red-600"
                              title="Supprimer"
                              onClick={() => removeEmployee(row)}
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!employees.length && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-slate-400">
                      Aucun travailleur enregistré.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "paie" && (
        <div className="space-y-4">
          <div className="card flex flex-wrap items-end gap-3 p-4">
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">Travailleur</span>
              <select
                className="input w-64"
                value={workerId}
                onChange={(e) => setWorkerId(Number(e.target.value))}
              >
                <option value={0}>Sélectionner…</option>
                {employees
                  .filter((row) => row.is_active)
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.matricule} — {row.full_name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">Mois</span>
              <select
                className="input w-40"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
              >
                {MONTHS.map((name, index) => (
                  <option key={name} value={index + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">Année</span>
              <input
                className="input w-28"
                type="number"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">Jours d'absence</span>
              <input
                className="input w-28"
                type="number"
                min={0}
                value={absence}
                onChange={(e) => setAbsence(Number(e.target.value))}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">Heures suppl.</span>
              <input
                className="input w-28"
                type="number"
                min={0}
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">Taux horaire</span>
              <input
                className="input w-28"
                type="number"
                min={0}
                value={hourRate}
                onChange={(e) => setHourRate(Number(e.target.value))}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">Mode de paiement</span>
              <select
                className="input w-40"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              >
                {METHODS.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <button className="btn-ghost" onClick={computeDraft}>
              <Calculator size={16} /> Recalculer
            </button>
          </div>

          {worker && draft && (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="card p-4">
                <h3 className="mb-2 font-semibold">Gains</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="py-1">Élément</th>
                      <th className="text-right">Quantité</th>
                      <th className="text-right">Taux</th>
                      <th className="text-right">Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.lines
                      .filter((line) => line.kind === "gain")
                      .map((line, index) => (
                        <tr
                          key={`${line.label}-${index}`}
                          className="border-t border-slate-100 dark:border-slate-700"
                        >
                          <td className="py-1">{line.label}</td>
                          <td className="text-right">{line.quantity || ""}</td>
                          <td className="text-right">{line.rate || ""}</td>
                          <td className="text-right">{formatMoney(line.amount)}</td>
                        </tr>
                      ))}
                    <tr className="border-t-2 border-slate-200 font-semibold">
                      <td className="py-1" colSpan={3}>
                        Total brut
                      </td>
                      <td className="text-right">{formatMoney(draft.gross)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="card p-4">
                <h3 className="mb-2 font-semibold">Retenues</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="py-1">Retenue</th>
                      <th className="text-right">Base</th>
                      <th className="text-right">Taux</th>
                      <th className="text-right">Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.lines
                      .filter((line) => line.kind === "retenue")
                      .map((line, index) => (
                        <tr
                          key={`${line.label}-${index}`}
                          className="border-t border-slate-100 dark:border-slate-700"
                        >
                          <td className="py-1">{line.label}</td>
                          <td className="text-right">
                            {line.base ? formatMoney(line.base) : ""}
                          </td>
                          <td className="text-right">{line.rate || ""}</td>
                          <td className="text-right">{formatMoney(line.amount)}</td>
                        </tr>
                      ))}
                    <tr className="border-t-2 border-slate-200 font-semibold">
                      <td className="py-1" colSpan={3}>
                        Total retenues
                      </td>
                      <td className="text-right">
                        {formatMoney(draft.deductions)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {worker && draft && (
            <div className="card flex flex-wrap items-center gap-3 p-4">
              <div className="text-lg font-bold">
                Net à payer : {formatMoney(draft.net)}
              </div>
              <span className="text-sm italic text-slate-500">
                {draft.net_in_words} francs CFA
              </span>
              <input
                className="input w-64"
                placeholder="Commentaire (facultatif)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="ml-auto flex flex-wrap gap-2">
                <button
                  className="btn-ghost"
                  onClick={() =>
                    setExtras([
                      ...extras,
                      {
                        kind: "retenue",
                        label: "Avance sur salaire",
                        quantity: 1,
                        rate: 0,
                        base: 0,
                        amount: 0,
                      },
                    ])
                  }
                >
                  <Plus size={16} /> Élément exceptionnel
                </button>
                {can("paie_gerer") && (
                  <button className="btn-ghost" onClick={() => savePayslip(false)}>
                    Enregistrer en brouillon
                  </button>
                )}
                {can("paie_valider") && (
                  <button className="btn-primary" onClick={() => savePayslip(true)}>
                    <BadgeCheck size={16} /> Valider et générer le bulletin
                  </button>
                )}
              </div>
            </div>
          )}

          {extras.length > 0 && (
            <div className="card space-y-2 p-4">
              <h3 className="font-semibold">Éléments exceptionnels du mois</h3>
              {extras.map((line, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <select
                    className="input w-36"
                    value={line.kind}
                    onChange={(e) => {
                      const next = [...extras];
                      next[index] = { ...line, kind: e.target.value };
                      setExtras(next);
                    }}
                  >
                    <option value="gain">Gain</option>
                    <option value="retenue">Retenue</option>
                  </select>
                  <input
                    className="input w-64"
                    placeholder="Libellé"
                    value={line.label}
                    onChange={(e) => {
                      const next = [...extras];
                      next[index] = { ...line, label: e.target.value };
                      setExtras(next);
                    }}
                  />
                  <input
                    className="input w-40"
                    type="number"
                    placeholder="Montant"
                    value={line.amount}
                    onChange={(e) => {
                      const next = [...extras];
                      next[index] = { ...line, amount: Number(e.target.value) };
                      setExtras(next);
                    }}
                  />
                  <button
                    className="btn-ghost text-red-600"
                    onClick={() =>
                      setExtras(extras.filter((_, other) => other !== index))
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <button className="btn-ghost" onClick={computeDraft}>
                <Calculator size={16} /> Appliquer au calcul
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "historique" && (
        <div className="card p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              className="input w-56"
              placeholder="Nom, prénoms ou matricule"
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
            />
            <select
              className="input w-36"
              value={historyMonth}
              onChange={(e) => setHistoryMonth(Number(e.target.value))}
            >
              <option value={0}>Tous les mois</option>
              {MONTHS.map((name, index) => (
                <option key={name} value={index + 1}>
                  {name}
                </option>
              ))}
            </select>
            <input
              className="input w-28"
              type="number"
              value={historyYear}
              onChange={(e) => setHistoryYear(Number(e.target.value))}
            />
            <select
              className="input w-40"
              value={historyDepartment}
              onChange={(e) => setHistoryDepartment(e.target.value)}
            >
              <option value="">Tous les services</option>
              {departments.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
            <select
              className="input w-36"
              value={historyStatus}
              onChange={(e) => setHistoryStatus(e.target.value)}
            >
              <option value="">Tous les statuts</option>
              {STATUSES.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
            {can("paie_imprimer") && (
              <button className="btn-ghost ml-auto" onClick={printSelection}>
                <Printer size={16} />
                {picked.length
                  ? `Imprimer ${picked.length} bulletin(s)`
                  : "Imprimer tous les bulletins"}
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-2"></th>
                  <th>Période</th>
                  <th>Matricule</th>
                  <th>Travailleur</th>
                  <th>Fonction</th>
                  <th className="text-right">Brut</th>
                  <th className="text-right">Retenues</th>
                  <th className="text-right">Net</th>
                  <th>Statut</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {payslips.map((slip) => (
                  <tr
                    key={slip.id}
                    className="border-t border-slate-100 dark:border-slate-700"
                  >
                    <td className="py-2">
                      <input
                        type="checkbox"
                        checked={picked.includes(slip.id)}
                        onChange={(e) =>
                          setPicked(
                            e.target.checked
                              ? [...picked, slip.id]
                              : picked.filter((id) => id !== slip.id)
                          )
                        }
                      />
                    </td>
                    <td>
                      {MONTHS[slip.month - 1]} {slip.year}
                    </td>
                    <td className="font-mono text-xs">
                      {slip.employee?.matricule}
                    </td>
                    <td className="font-medium">{slip.employee?.full_name}</td>
                    <td>{slip.employee?.job || "—"}</td>
                    <td className="text-right">{formatMoney(slip.gross)}</td>
                    <td className="text-right">{formatMoney(slip.deductions)}</td>
                    <td className="text-right font-semibold">
                      {formatMoney(slip.net)}
                    </td>
                    <td>
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${badge(
                          slip.status
                        )}`}
                      >
                        {slip.status}
                      </span>
                    </td>
                    <td className="py-2">
                      <div className="flex justify-end gap-1">
                        <button
                          className="btn-ghost"
                          title="Aperçu"
                          onClick={() => setPreview(slip)}
                        >
                          <Eye size={16} />
                        </button>
                        {can("paie_imprimer") && (
                          <button
                            className="btn-ghost"
                            title="Imprimer / PDF"
                            onClick={() => printPayslips([slip], company)}
                          >
                            <Printer size={16} />
                          </button>
                        )}
                        {slip.status === "Brouillon" && can("paie_gerer") && (
                          <button
                            className="btn-ghost"
                            title="Modifier"
                            onClick={() => editSlip(slip)}
                          >
                            <Pencil size={16} />
                          </button>
                        )}
                        {slip.status === "Brouillon" && can("paie_valider") && (
                          <button
                            className="btn-ghost"
                            title="Valider"
                            onClick={() => act(slip, "valider")}
                          >
                            <BadgeCheck size={16} />
                          </button>
                        )}
                        {slip.status !== "Payée" &&
                          slip.status !== "Annulée" &&
                          can("paie_payer") && (
                            <button
                              className="btn-ghost"
                              title="Marquer payée"
                              onClick={() => act(slip, "payer")}
                            >
                              <Wallet size={16} />
                            </button>
                          )}
                        {can("paie_gerer") && (
                          <button
                            className="btn-ghost"
                            title="Dupliquer"
                            onClick={() => duplicate(slip)}
                          >
                            <Plus size={16} />
                          </button>
                        )}
                        {slip.status !== "Annulée" && can("paie_annuler") && (
                          <button
                            className="btn-ghost text-red-600"
                            title="Annuler"
                            onClick={() => {
                              setCancelling(slip);
                              setReason("");
                            }}
                          >
                            <Ban size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!payslips.length && (
                  <tr>
                    <td colSpan={10} className="py-6 text-center text-slate-400">
                      Aucun bulletin sur cette période.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "recap" && (
        <div className="space-y-4">
          <div className="card flex flex-wrap items-end gap-3 p-4">
            <select
              className="input w-40"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {MONTHS.map((name, index) => (
                <option key={name} value={index + 1}>
                  {name}
                </option>
              ))}
            </select>
            <input
              className="input w-28"
              type="number"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            />
            <div className="ml-auto flex gap-2">
              <button className="btn-ghost" onClick={exportRecap}>
                <Download size={16} /> Exporter Excel
              </button>
              <button className="btn-primary" onClick={printRecap}>
                <Printer size={16} /> Imprimer / PDF
              </button>
            </div>
          </div>
          {recap && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {[
                  ["Travailleurs payés", recap.employees, false],
                  ["Total salaires de base", recap.base_total, true],
                  ["Total primes et indemnités", recap.gains_total, true],
                  ["Total brut", recap.gross_total, true],
                  ["Total retenues", recap.deductions_total, true],
                  ["Total net à payer", recap.net_total, true],
                ].map(([label, value, money]) => (
                  <div key={String(label)} className="card p-4">
                    <p className="text-sm text-slate-500">{label}</p>
                    <p className="text-xl font-bold">
                      {money ? formatMoney(Number(value)) : value}
                    </p>
                  </div>
                ))}
              </div>
              <div className="card overflow-x-auto p-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="py-2">Matricule</th>
                      <th>Travailleur</th>
                      <th className="text-right">Brut</th>
                      <th className="text-right">Retenues</th>
                      <th className="text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recap.rows.map((row) => (
                      <tr
                        key={row.matricule}
                        className="border-t border-slate-100 dark:border-slate-700"
                      >
                        <td className="py-2 font-mono text-xs">{row.matricule}</td>
                        <td>{row.employee}</td>
                        <td className="text-right">{formatMoney(row.gross)}</td>
                        <td className="text-right">
                          {formatMoney(row.deductions)}
                        </td>
                        <td className="text-right font-semibold">
                          {formatMoney(row.net)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "parametres" && (
        <div className="card p-4">
          <p className="mb-3 text-sm text-slate-500">
            <Settings2 size={14} className="mr-1 inline" />
            Les primes et les retenues appliquées automatiquement à chaque paie.
            Un élément daté n'entre en compte que pour les mois de sa période :
            les bulletins déjà émis gardent leurs propres montants.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-2">Libellé</th>
                  <th>Type</th>
                  <th>Calcul</th>
                  <th className="text-right">Valeur</th>
                  <th>Base</th>
                  <th className="text-right">Plafond</th>
                  <th>Période</th>
                  <th>État</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {elements.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t border-slate-100 dark:border-slate-700"
                  >
                    <td className="py-2 font-medium">{row.name}</td>
                    <td>{row.kind === "gain" ? "Gain" : "Retenue"}</td>
                    <td>{row.mode === "fixe" ? "Montant fixe" : "Pourcentage"}</td>
                    <td className="text-right">
                      {row.mode === "fixe"
                        ? formatMoney(row.value)
                        : `${row.value} %`}
                    </td>
                    <td>{row.base === "brut" ? "Salaire brut" : "Salaire de base"}</td>
                    <td className="text-right">
                      {row.ceiling ? formatMoney(row.ceiling) : "—"}
                    </td>
                    <td className="text-xs text-slate-500">
                      {row.starts_on
                        ? new Date(row.starts_on).toLocaleDateString("fr-FR")
                        : "—"}
                      {" → "}
                      {row.ends_on
                        ? new Date(row.ends_on).toLocaleDateString("fr-FR")
                        : "—"}
                    </td>
                    <td>{row.is_active ? "Actif" : "Inactif"}</td>
                    <td className="py-2">
                      {can("paie_parametres") && (
                        <div className="flex justify-end gap-1">
                          <button
                            className="btn-ghost"
                            onClick={() => {
                              setElementEditing(row);
                              setElementForm({
                                ...EMPTY_ELEMENT,
                                ...row,
                                starts_on: row.starts_on?.slice(0, 10) ?? "",
                                ends_on: row.ends_on?.slice(0, 10) ?? "",
                              });
                              setElementOpen(true);
                            }}
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            className="btn-ghost text-red-600"
                            onClick={() => removeElement(row)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {!elements.length && (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-slate-400">
                      Aucun élément configuré : ajoutez vos primes et vos
                      retenues, avec leurs taux et leurs plafonds.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={employeeOpen}
        onClose={() => setEmployeeOpen(false)}
        title={editing ? "Modifier le travailleur" : "Nouveau travailleur"}
        wide
        footer={
          <>
            <button className="btn-ghost" onClick={() => setEmployeeOpen(false)}>
              Annuler
            </button>
            <button className="btn-primary" onClick={saveEmployee}>
              Enregistrer
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Matricule</span>
            <input
              className="input"
              placeholder="Automatique si vide"
              value={employeeForm.matricule}
              onChange={(e) =>
                setEmployeeForm({ ...employeeForm, matricule: e.target.value })
              }
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Nom *</span>
            <input
              className="input"
              value={employeeForm.last_name}
              onChange={(e) =>
                setEmployeeForm({ ...employeeForm, last_name: e.target.value })
              }
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Prénoms</span>
            <input
              className="input"
              value={employeeForm.first_name}
              onChange={(e) =>
                setEmployeeForm({ ...employeeForm, first_name: e.target.value })
              }
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Sexe</span>
            <select
              className="input"
              value={employeeForm.gender}
              onChange={(e) =>
                setEmployeeForm({ ...employeeForm, gender: e.target.value })
              }
            >
              <option value="">—</option>
              <option value="M">Masculin</option>
              <option value="F">Féminin</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Date de naissance</span>
            <input
              className="input"
              type="date"
              value={employeeForm.birth_date}
              onChange={(e) =>
                setEmployeeForm({ ...employeeForm, birth_date: e.target.value })
              }
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Contact</span>
            <input
              className="input"
              value={employeeForm.phone}
              onChange={(e) =>
                setEmployeeForm({ ...employeeForm, phone: e.target.value })
              }
            />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-slate-500">Adresse</span>
            <input
              className="input"
              value={employeeForm.address}
              onChange={(e) =>
                setEmployeeForm({ ...employeeForm, address: e.target.value })
              }
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Fonction / poste</span>
            <input
              className="input"
              value={employeeForm.job}
              onChange={(e) =>
                setEmployeeForm({ ...employeeForm, job: e.target.value })
              }
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Service</span>
            <input
              className="input"
              value={employeeForm.department}
              onChange={(e) =>
                setEmployeeForm({ ...employeeForm, department: e.target.value })
              }
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Date d'embauche</span>
            <input
              className="input"
              type="date"
              value={employeeForm.hired_at}
              onChange={(e) =>
                setEmployeeForm({ ...employeeForm, hired_at: e.target.value })
              }
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Type de contrat</span>
            <input
              className="input"
              list="contrats-paie"
              value={employeeForm.contract}
              onChange={(e) =>
                setEmployeeForm({ ...employeeForm, contract: e.target.value })
              }
            />
            <datalist id="contrats-paie">
              {CONTRACTS.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Statut</span>
            <input
              className="input"
              value={employeeForm.status}
              onChange={(e) =>
                setEmployeeForm({ ...employeeForm, status: e.target.value })
              }
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Salaire de base</span>
            <input
              className="input"
              type="number"
              min={0}
              value={employeeForm.base_salary}
              onChange={(e) =>
                setEmployeeForm({
                  ...employeeForm,
                  base_salary: Number(e.target.value),
                })
              }
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Mode de paiement</span>
            <select
              className="input"
              value={employeeForm.payment_method}
              onChange={(e) =>
                setEmployeeForm({
                  ...employeeForm,
                  payment_method: e.target.value,
                })
              }
            >
              {METHODS.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Banque</span>
            <input
              className="input"
              value={employeeForm.bank}
              onChange={(e) =>
                setEmployeeForm({ ...employeeForm, bank: e.target.value })
              }
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Numéro de compte</span>
            <input
              className="input"
              value={employeeForm.account_number}
              onChange={(e) =>
                setEmployeeForm({
                  ...employeeForm,
                  account_number: e.target.value,
                })
              }
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Numéro CNPS</span>
            <input
              className="input"
              value={employeeForm.social_number}
              onChange={(e) =>
                setEmployeeForm({
                  ...employeeForm,
                  social_number: e.target.value,
                })
              }
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Email</span>
            <input
              className="input"
              value={employeeForm.email}
              onChange={(e) =>
                setEmployeeForm({ ...employeeForm, email: e.target.value })
              }
            />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-slate-500">Observations</span>
            <textarea
              className="input"
              rows={2}
              value={employeeForm.note}
              onChange={(e) =>
                setEmployeeForm({ ...employeeForm, note: e.target.value })
              }
            />
          </label>
        </div>
      </Modal>

      <Modal
        open={elementOpen}
        onClose={() => setElementOpen(false)}
        title={elementEditing ? "Modifier l'élément" : "Nouvel élément de paie"}
        footer={
          <>
            <button className="btn-ghost" onClick={() => setElementOpen(false)}>
              Annuler
            </button>
            <button className="btn-primary" onClick={saveElement}>
              Enregistrer
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-slate-500">Libellé *</span>
            <input
              className="input"
              placeholder="Prime de transport, cotisation…"
              value={elementForm.name}
              onChange={(e) =>
                setElementForm({ ...elementForm, name: e.target.value })
              }
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Type</span>
            <select
              className="input"
              value={elementForm.kind}
              onChange={(e) =>
                setElementForm({ ...elementForm, kind: e.target.value })
              }
            >
              <option value="gain">Gain</option>
              <option value="retenue">Retenue</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Mode de calcul</span>
            <select
              className="input"
              value={elementForm.mode}
              onChange={(e) =>
                setElementForm({ ...elementForm, mode: e.target.value })
              }
            >
              <option value="fixe">Montant fixe</option>
              <option value="pourcentage">Pourcentage</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">
              {elementForm.mode === "fixe" ? "Montant" : "Taux (%)"}
            </span>
            <input
              className="input"
              type="number"
              min={0}
              step="0.01"
              value={elementForm.value}
              onChange={(e) =>
                setElementForm({ ...elementForm, value: Number(e.target.value) })
              }
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Base de calcul</span>
            <select
              className="input"
              value={elementForm.base}
              onChange={(e) =>
                setElementForm({ ...elementForm, base: e.target.value })
              }
            >
              <option value="base">Salaire de base</option>
              <option value="brut">Salaire brut</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Plafond (0 = aucun)</span>
            <input
              className="input"
              type="number"
              min={0}
              value={elementForm.ceiling}
              onChange={(e) =>
                setElementForm({
                  ...elementForm,
                  ceiling: Number(e.target.value),
                })
              }
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Début d'application</span>
            <input
              className="input"
              type="date"
              value={elementForm.starts_on}
              onChange={(e) =>
                setElementForm({ ...elementForm, starts_on: e.target.value })
              }
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Fin d'application</span>
            <input
              className="input"
              type="date"
              value={elementForm.ends_on}
              onChange={(e) =>
                setElementForm({ ...elementForm, ends_on: e.target.value })
              }
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={elementForm.is_active}
              onChange={(e) =>
                setElementForm({ ...elementForm, is_active: e.target.checked })
              }
            />
            Actif
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={elementForm.automatic}
              onChange={(e) =>
                setElementForm({ ...elementForm, automatic: e.target.checked })
              }
            />
            Appliqué automatiquement
          </label>
        </div>
      </Modal>

      <Modal
        open={preview !== null}
        onClose={() => setPreview(null)}
        title={`Bulletin ${preview?.reference ?? ""}`}
        wide
        footer={
          <>
            <button className="btn-ghost" onClick={() => setPreview(null)}>
              Fermer
            </button>
            {can("paie_imprimer") && preview && (
              <button
                className="btn-primary"
                onClick={() => printPayslips([preview], company)}
              >
                <Printer size={16} /> Imprimer / PDF
              </button>
            )}
          </>
        }
      >
        {preview && (
          <iframe
            title="Aperçu du bulletin"
            className="h-[60vh] w-full rounded-lg border border-slate-200 bg-white"
            srcDoc={
              `<html><head><style>${PAYSLIP_STYLE}` +
              `.sheet{padding:8mm}</style></head><body>` +
              `${payslipSheet(preview, company)}</body></html>`
            }
          />
        )}
      </Modal>

      <Modal
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        title="Annuler le bulletin"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setCancelling(null)}>
              Revenir
            </button>
            <button className="btn-primary" onClick={confirmCancel}>
              Confirmer l'annulation
            </button>
          </>
        }
      >
        <p className="mb-3 text-sm text-slate-600">
          Le bulletin {cancelling?.reference} restera dans l'historique avec son
          motif d'annulation.
        </p>
        <input
          className="input"
          placeholder="Motif de l'annulation"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Modal>
    </div>
  );
}
