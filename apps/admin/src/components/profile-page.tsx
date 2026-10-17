"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody } from "@/components/ui/card";
import { useToastMessage, ToastBanner } from "@/components/ui/toast";
import { Icon } from "@/components/ui/icon";

interface ProfileValues {
  fullName: string;
  gender: string;
  dateOfBirth: string;
  ppiCountry: string;
  university: string;
  educationLevel: string;
  majors: string;
  yearOfEntry: string;
  estimatedGraduation: string;
  addressAbroad: string;
  addressId: string;
  whatsapp: string;
  emergencyContact: string;
  timezone: string;
}

const START: ProfileValues = {
  fullName: "Ahmad Rizky",
  gender: "Male",
  dateOfBirth: "2022-08-15",
  ppiCountry: "PPI Tiongkok",
  university: "Fudan University",
  educationLevel: "Undergraduate",
  majors: "Computer Science",
  yearOfEntry: "2022-09-01",
  estimatedGraduation: "2026-06-30",
  addressAbroad: "Room 305, Building 12, University Dormitory, Shanghai, China",
  addressId: "Jl. Melati No. 25, Bandung, Jawa Barat, Indonesia",
  whatsapp: "6281234567890",
  emergencyContact: "6281234567890",
  // empty timezone = follow the selected PPI Country's default
  timezone: "",
};

// PPIDK Asia Oceania chapters (same list as the Organizations page)
const COUNTRIES = [
  "PPI Australia",
  "PPI Jepang",
  "PPI Korea",
  "PPI Tiongkok",
  "PPI Taiwan",
  "PPI Hong Kong",
  "PPI Singapura",
  "PPI Malaysia",
  "PPI Thailand",
  "PPI Vietnam",
  "PPI Filipina",
  "PPI Selandia Baru",
];

const COUNTRY_UNIVERSITIES: Record<string, string[]> = {
  "PPI Australia": [
    "University of Melbourne",
    "University of Sydney",
    "Monash University",
    "Australian National University",
    "UNSW Sydney",
    "University of Queensland",
  ],
  "PPI Jepang": [
    "University of Tokyo",
    "Kyoto University",
    "Waseda University",
    "Osaka University",
    "Tokyo Institute of Technology",
  ],
  "PPI Korea": ["Seoul National University", "Yonsei University", "Korea University", "KAIST"],
  "PPI Tiongkok": [
    "Fudan University",
    "Shanghai Jiao Tong University",
    "Tongji University",
    "East China Normal University",
    "Tsinghua University",
    "Peking University",
  ],
  "PPI Taiwan": [
    "National Taiwan University",
    "National Tsing Hua University",
    "National Cheng Kung University",
    "National Taiwan Normal University",
  ],
  "PPI Hong Kong": [
    "University of Hong Kong",
    "HK University of Science and Technology",
    "Chinese University of Hong Kong",
    "City University of Hong Kong",
  ],
  "PPI Singapura": [
    "National University of Singapore",
    "Nanyang Technological University",
    "Singapore Management University",
  ],
  "PPI Malaysia": [
    "University of Malaya",
    "Universiti Kebangsaan Malaysia",
    "Universiti Putra Malaysia",
    "Taylor's University",
  ],
  "PPI Thailand": [
    "Chulalongkorn University",
    "Mahidol University",
    "Kasetsart University",
    "Thammasat University",
  ],
  "PPI Vietnam": [
    "Vietnam National University Hanoi",
    "Hanoi University of Science and Technology",
    "University of Economics Ho Chi Minh City",
  ],
  "PPI Filipina": [
    "University of the Philippines",
    "Ateneo de Manila University",
    "De La Salle University",
    "University of Santo Tomas",
  ],
  "PPI Selandia Baru": [
    "University of Auckland",
    "Victoria University of Wellington",
    "University of Otago",
  ],
};

/** University options follow the selected PPI Country (Asia Oceania). */
const universitiesFor = (country: string): string[] =>
  COUNTRY_UNIVERSITIES[country] ?? COUNTRY_UNIVERSITIES["PPI Tiongkok"]!;
const EDUCATION = ["Undergraduate", "Master's Degree", "Doctoral Degree"];
const COUNTRY_TIMEZONES: Record<string, string[]> = {
  "PPI Australia": [
    "Sydney (UTC+11)",
    "Melbourne (UTC+11)",
    "Brisbane (UTC+10)",
    "Perth (UTC+8)",
    "Adelaide (UTC+9:30)",
  ],
  "PPI Jepang": ["Tokyo (UTC+9)", "Osaka (UTC+9)", "Kyoto (UTC+9)"],
  "PPI Korea": ["Seoul (UTC+9)", "Busan (UTC+9)", "Incheon (UTC+9)"],
  "PPI Tiongkok": ["Shanghai (UTC+8)", "Beijing (UTC+8)", "Guangzhou (UTC+8)", "Chengdu (UTC+8)"],
  "PPI Taiwan": ["Taipei (UTC+8)", "Kaohsiung (UTC+8)"],
  "PPI Hong Kong": ["Hong Kong (UTC+8)"],
  "PPI Singapura": ["Singapore (UTC+8)"],
  "PPI Malaysia": ["Kuala Lumpur (UTC+8)", "Penang (UTC+8)"],
  "PPI Thailand": ["Bangkok (UTC+7)", "Chiang Mai (UTC+7)"],
  "PPI Vietnam": ["Hanoi (UTC+7)", "Ho Chi Minh City (UTC+7)"],
  "PPI Filipina": ["Manila (UTC+8)", "Cebu (UTC+8)"],
  "PPI Selandia Baru": ["Auckland (UTC+13)", "Wellington (UTC+13)", "Christchurch (UTC+13)"],
};

/** Timezone options follow the selected PPI Country (Asia Oceania). */
const timezonesFor = (country: string): string[] =>
  COUNTRY_TIMEZONES[country] ?? COUNTRY_TIMEZONES["PPI Tiongkok"]!;

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${String(d).padStart(2, "0")} ${MONTHS[(m ?? 1) - 1] ?? ""} ${y}`;
}

function FieldValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="admin-acct-field">
      <span className="admin-acct-field__label">{label}</span>
      <span className="admin-acct-field__value">{children}</span>
    </div>
  );
}

/**
 * Recovered admin Profile page (view + Edit Profile form, Vite admin session
 * b561ba27) ported to the new admin. The view shows the member fields
 * (Full Name, Gender, Date of Birth, PPI Country, University, Education Level,
 * Majors, Year of Entry, Estimated Year of Graduation, addresses, contacts,
 * timezone); "Edit Profile" toggles the same data into editable controls and
 * Save applies them back to the view state with a toast.
 */
export function ProfilePage() {
  const { message: toastMessage, show: toast } = useToastMessage();
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [v, setV] = useState<ProfileValues>(START);
  const [uniOther, setUniOther] = useState(false);
  const tzOptions = timezonesFor(v.ppiCountry);
  // empty timezone = follow the selected PPI Country's default
  const effectiveTimezone = v.timezone === "" ? tzOptions[0]! : v.timezone;

  if (mode === "view") {
    return (
      <div className="admin-acct-page">
        <Card className="admin-acct-card">
          <div className="admin-card__header">
            <div className="admin-card__title">Profile</div>
            <div className="admin-card__actions">
              <button
                type="button"
                className="admin-acct-btn--cream"
                onClick={() => setMode("edit")}
              >
                <Icon name="edit" size={16} />
                Edit Profile
              </button>
            </div>
          </div>
          <CardBody>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
              <div className="admin-acct-fields">
                <FieldValue label="Full Name">{v.fullName}</FieldValue>
                <FieldValue label="Gender">{v.gender}</FieldValue>
                <FieldValue label="Date of Birth">{fmtDate(v.dateOfBirth)}</FieldValue>
              </div>

              <div className="admin-acct-fields">
                <FieldValue label="PPI Country">{v.ppiCountry}</FieldValue>
                <FieldValue label="University">{v.university}</FieldValue>
                <FieldValue label="Education Level">{v.educationLevel}</FieldValue>
              </div>

              <div className="admin-acct-fields">
                <FieldValue label="Majors">{v.majors}</FieldValue>
                <FieldValue label="Year of Entry">{fmtDate(v.yearOfEntry)}</FieldValue>
                <FieldValue label="Estimated Year of Graduation">
                  {fmtDate(v.estimatedGraduation)}
                </FieldValue>
              </div>

              <div className="admin-acct-divider" />

              <div className="admin-acct-fields admin-acct-fields--2">
                <FieldValue label="Detail Address Abroad">{v.addressAbroad}</FieldValue>
                <FieldValue label="Detail Address in Indonesia">{v.addressId}</FieldValue>
              </div>

              <div className="admin-acct-fields admin-acct-fields--2">
                <FieldValue label="WhatsApp Number">{v.whatsapp}</FieldValue>
                <FieldValue label="Emergency Contact Number">{v.emergencyContact}</FieldValue>
              </div>

              <div className="admin-acct-fields">
                <FieldValue label="Timezone">
                  Currently using selected PPI Country - {effectiveTimezone}
                </FieldValue>
              </div>

              <div className="admin-acct-divider" />

              <div>
                <button
                  type="button"
                  className="admin-acct-btn--cream"
                  onClick={() => router.back()}
                >
                  <Icon name="chevronLeft" size={16} />
                  Back
                </button>
              </div>
            </div>
          </CardBody>
        </Card>
        <ToastBanner message={toastMessage} />
      </div>
    );
  }

  return (
    <div className="admin-acct-page">
      <Card className="admin-acct-card">
        <div className="admin-card__header">
          <div className="admin-card__title">Edit Profile</div>
        </div>
        <CardBody className="admin-acct-edit">
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
            <div className="admin-acct-fields">
              <FieldValue label="Full Name">
                <input
                  className="admin-acct-input-cream"
                  defaultValue={v.fullName}
                  onChange={(e) => setV({ ...v, fullName: e.target.value })}
                />
              </FieldValue>
              <FieldValue label="Gender">
                <select
                  className="admin-acct-input-cream"
                  defaultValue={v.gender}
                  onChange={(e) => setV({ ...v, gender: e.target.value })}
                >
                  <option>Male</option>
                  <option>Female</option>
                </select>
              </FieldValue>
              <FieldValue label="Date of Birth">
                <input
                  className="admin-acct-input-cream"
                  type="date"
                  defaultValue={v.dateOfBirth}
                  onChange={(e) => setV({ ...v, dateOfBirth: e.target.value })}
                />
              </FieldValue>
            </div>

            <div className="admin-acct-fields">
              <FieldValue label="PPI Country">
                <select
                  className="admin-acct-input-cream"
                  defaultValue={v.ppiCountry}
                  onChange={(e) =>
                    setV({
                      ...v,
                      ppiCountry: e.target.value,
                      university: uniOther ? v.university : universitiesFor(e.target.value)[0]!,
                      timezone: "",
                    })
                  }
                >
                  {COUNTRIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </FieldValue>
              <FieldValue label="University">
                {uniOther ? (
                  <input
                    className="admin-acct-input-cream"
                    placeholder="Type your university"
                    value={v.university}
                    onChange={(e) => setV({ ...v, university: e.target.value })}
                  />
                ) : (
                  <select
                    className="admin-acct-input-cream"
                    value={v.university}
                    onChange={(e) => {
                      if (e.target.value === "__other__") {
                        setUniOther(true);
                        setV({ ...v, university: "" });
                      } else {
                        setV({ ...v, university: e.target.value });
                      }
                    }}
                  >
                    {universitiesFor(v.ppiCountry).map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                    <option value="__other__">Other</option>
                  </select>
                )}
              </FieldValue>
              <FieldValue label="Education Level">
                <select
                  className="admin-acct-input-cream"
                  defaultValue={v.educationLevel}
                  onChange={(e) => setV({ ...v, educationLevel: e.target.value })}
                >
                  {EDUCATION.map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </FieldValue>
            </div>

            <div className="admin-acct-fields">
              <FieldValue label="Majors">
                <input
                  className="admin-acct-input-cream"
                  defaultValue={v.majors}
                  onChange={(e) => setV({ ...v, majors: e.target.value })}
                />
              </FieldValue>
              <FieldValue label="Year of Entry">
                <input
                  className="admin-acct-input-cream"
                  type="date"
                  defaultValue={v.yearOfEntry}
                  onChange={(e) => setV({ ...v, yearOfEntry: e.target.value })}
                />
              </FieldValue>
              <FieldValue label="Estimated Year of Graduation">
                <input
                  className="admin-acct-input-cream"
                  type="date"
                  defaultValue={v.estimatedGraduation}
                  onChange={(e) => setV({ ...v, estimatedGraduation: e.target.value })}
                />
              </FieldValue>
            </div>

            <div className="admin-acct-divider" />

            <div className="admin-acct-fields admin-acct-fields--2">
              <FieldValue label="Detail Address Abroad">
                <textarea
                  className="admin-acct-input-cream"
                  rows={3}
                  defaultValue={v.addressAbroad}
                  onChange={(e) => setV({ ...v, addressAbroad: e.target.value })}
                />
              </FieldValue>
              <FieldValue label="Detail Address in Indonesia">
                <textarea
                  className="admin-acct-input-cream"
                  rows={3}
                  defaultValue={v.addressId}
                  onChange={(e) => setV({ ...v, addressId: e.target.value })}
                />
              </FieldValue>
            </div>

            <div className="admin-acct-fields admin-acct-fields--2">
              <FieldValue label="WhatsApp Number">
                <input
                  className="admin-acct-input-cream"
                  defaultValue={v.whatsapp}
                  onChange={(e) => setV({ ...v, whatsapp: e.target.value })}
                />
              </FieldValue>
              <FieldValue label="Emergency Contact Number">
                <input
                  className="admin-acct-input-cream"
                  defaultValue={v.emergencyContact}
                  onChange={(e) => setV({ ...v, emergencyContact: e.target.value })}
                />
              </FieldValue>
            </div>

            <div className="admin-acct-fields">
              <div className="admin-acct-field admin-acct-field--full">
                <span className="admin-acct-field__label">Timezone</span>
                <select
                  className="admin-acct-input-cream"
                  value={v.timezone}
                  onChange={(e) => setV({ ...v, timezone: e.target.value })}
                >
                  <option value="">
                    Currently using selected PPI Country - {effectiveTimezone}
                  </option>
                  {tzOptions.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="admin-acct-divider" />

            <div className="admin-acct-foot">
              <button
                type="button"
                className="admin-acct-btn--cream"
                onClick={() => setMode("view")}
              >
                <Icon name="chevronLeft" size={16} />
                Back
              </button>
              <button
                type="button"
                className="admin-acct-btn--cream"
                onClick={() => {
                  setMode("view");
                  toast("Profile saved");
                }}
              >
                <Icon name="cloud" size={16} />
                Save
              </button>
            </div>
          </div>
        </CardBody>
      </Card>
      <ToastBanner message={toastMessage} />
    </div>
  );
}
