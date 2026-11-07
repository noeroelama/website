"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SocialLinks } from "./social-links";

/**
 * Member councils (Figma "HOME PUBLIC" Frame 2399): one full-bleed slide per PPI country,
 * in the visual order of the frame (left to right). The photos live in public/home/1.png
 * .. 17.png and overlay the design's dark 70% panel with the country name and description.
 */
const COUNTRIES = [
  {
    name: "PPI Selandia Baru",
    desc: "New Zealand is an island country in the South Pacific Ocean and the southwesternmost part of Polynesia. It lies more than 1,000 miles (1,600 km) southeast of Australia, its nearest neighbor. The country has two main islands, the North Island and the South Island, plus many smaller islands. Its capital is Wellington, and its largest city is Auckland.",
  },
  {
    name: "PPI Australia",
    desc: "Australia is a country and continent between the Indian and Pacific Oceans. It is the smallest continent and the sixth-largest country in the world by area. It has six states and two major mainland territories, and most people live along the eastern and southeastern coasts. Its capital is Canberra, and its largest cities are Sydney and Melbourne.",
  },
  {
    name: "PPI Malaysia",
    desc: "Malaysia is a country in Southeast Asia with two regions separated by the South China Sea. Peninsular Malaysia is on the Malay Peninsula, and East Malaysia (Sabah and Sarawak) is on the island of Borneo. It borders Thailand, Indonesia and Brunei, and shares sea borders with Singapore. Its capital is Kuala Lumpur, and the federal government sits in Putrajaya.",
  },
  {
    name: "PPI Singapura",
    desc: "Singapore is an island city-state at the southern tip of the Malay Peninsula, about 137 km (85 miles) north of the equator. The Johor Strait separates it from Malaysia, and the Singapore Strait separates it from Indonesia's Riau Islands. It is made up of one main island and around 60 smaller islets. Although it is small, it is one of the world's leading centers for finance, trade and shipping.",
  },
  {
    name: "PERMITHA (PPI Thailand)",
    desc: "Thailand is a country in the center of mainland Southeast Asia. It borders Myanmar, Laos, Cambodia and Malaysia, and has coastlines on the Gulf of Thailand and the Andaman Sea. It is the only Southeast Asian country that was never colonized by a European power. Its capital and largest city is Bangkok.",
  },
  {
    name: "PPI Filipina",
    desc: "The Philippines is an archipelago in the western Pacific Ocean made up of more than 7,600 islands. The islands form three main groups: Luzon, the Visayas and Mindanao. The country lies east of Vietnam across the South China Sea and north of Indonesia. Its capital is Manila.",
  },
  {
    name: "PPI Brunei Darussalam",
    desc: "Brunei Darussalam is a small sultanate on the northern coast of Borneo, facing the South China Sea. On land it is surrounded by the Malaysian state of Sarawak, which also splits the country into two separate parts. Its oil and natural gas reserves make it one of the wealthiest countries in the region. Its capital is Bandar Seri Begawan.",
  },
  {
    name: "PPI Tiongkok",
    desc: "China is a country in East Asia and one of the largest in the world by both area and population. It covers about 9.6 million square km (3.7 million square miles) and borders 14 countries. Its landscape ranges from the Himalayas and deserts in the west to fertile plains and long coastlines in the east. Its capital is Beijing, and its largest urban center is Shanghai.",
  },
  {
    name: "PPI Taiwan",
    desc: "Taiwan is an island in East Asia, about 160 km (100 miles) off the southeastern coast of mainland China across the Taiwan Strait. Japan lies to the northeast and the Philippines to the south. The island is mountainous in the east and has densely populated plains in the west. It is known worldwide for its technology and semiconductor industry. Its main city is Taipei.",
  },
  {
    name: "PERPIKA (PPI Korea Selatan)",
    desc: "South Korea is a country in East Asia that covers the southern half of the Korean Peninsula. It borders North Korea to the north across the Demilitarized Zone. The Yellow Sea lies to the west, the East Sea (Sea of Japan) to the east, and the Korea Strait separates it from Japan. Its capital and largest city is Seoul.",
  },
  {
    name: "PPI Jepang",
    desc: "Japan is an island country in East Asia, in the Pacific Ocean off the eastern coast of the Asian mainland. It has four main islands (Hokkaido, Honshu, Shikoku and Kyushu) and thousands of smaller ones. Much of the country is mountainous and volcanic. Its capital, Tokyo, is one of the largest metropolitan areas in the world.",
  },
  {
    name: "PPI India",
    desc: "India is a country in South Asia that covers most of the Indian subcontinent. It is the world's most populous country and the seventh-largest by area. It borders Pakistan, China, Nepal, Bhutan, Bangladesh and Myanmar, and is bounded by the Arabian Sea, the Bay of Bengal and the Indian Ocean. Its capital is New Delhi.",
  },
  {
    name: "PPI Kazakhstan",
    desc: "Kazakhstan is a country in Central Asia, and a small part of it lies in Eastern Europe west of the Ural River. It is the largest landlocked country in the world and the ninth-largest country overall. It borders Russia, China, Kyrgyzstan, Uzbekistan and Turkmenistan, and has a coastline on the Caspian Sea. Its capital is Astana, and its largest city is Almaty.",
  },
  {
    name: "PPI Vietnam",
    desc: "Vietnam is a long, S-shaped country on the eastern edge of mainland Southeast Asia. It borders China to the north and Laos and Cambodia to the west, with the South China Sea (East Sea) along its eastern and southern coasts. Its main population centers are in two river deltas, the Red River in the north and the Mekong in the south. Its capital is Hanoi, and its largest city is Ho Chi Minh City.",
  },
  {
    name: "PPI Kirgistan",
    desc: "Kyrgyzstan is a landlocked, mountainous country in Central Asia, and the Tian Shan range covers most of its territory. It borders Kazakhstan, Uzbekistan, Tajikistan and China. It is known for its alpine scenery and for Issyk-Kul, one of the largest mountain lakes in the world. Its capital and largest city is Bishkek.",
  },
  {
    name: "PPI Bangladesh",
    desc: "Bangladesh is a country in South Asia at the head of the Bay of Bengal. India surrounds it on almost all sides, and it shares a short border with Myanmar in the southeast. Most of the country sits on the Ganges–Brahmaputra delta, one of the largest river deltas in the world. It is also one of the most densely populated countries on Earth. Its capital is Dhaka.",
  },
  {
    name: "PPI Sri Lanka",
    desc: "Sri Lanka is an island country in the Indian Ocean, off the southeastern tip of India. The Palk Strait and the Gulf of Mannar separate it from the Indian subcontinent. It is known for its tea, beaches and ancient Buddhist heritage. Its commercial capital is Colombo, and its legislative capital is Sri Jayawardenepura Kotte.",
  },
] as const;

export interface PpiSliderStrings {
  readonly previous: string;
  readonly next: string;
}

/** Placeholder contact email per country, e.g. "selandiabaru@example.com". */
function emailFor(countryName: string): string {
  const slug = countryName
    .replace(/^PPI /, "")
    .replace(/^(PERMITHA|PERPIKA) \(PPI /, "")
    .replace(/\)$/, "")
    .replace(/[^A-Za-z]/g, "")
    .toLowerCase();
  return `${slug}@example.com`;
}

/**
 * Visible panel content of one slide (title, description, PIC, social). The previous
 * slide's panel is also rendered ("ghost", dimmed) next to the active one (user).
 */
function SlideContent({ country }: { country: (typeof COUNTRIES)[number] }) {
  return (
    <>
      <h2>{country.name}</h2>
      <p className="ppi-slider__desc">{country.desc}</p>
      <div className="ppi-slider__pic">
        <strong>Budi Setiawan</strong>
        <span className="ppi-slider__pic-role">Ketua {country.name}</span>
        <span>Email: {emailFor(country.name)}</span>
        <span>Phone: +00 000 0000 000</span>
      </div>
      <p className="ppi-slider__social-label">{country.name}</p>
      <SocialLinks className="ppi-slider__social" label={`Media sosial ${country.name}`} />
    </>
  );
}

/**
 * Swipeable country carousel: one full-bleed photo per member council, scrolled with mouse
 * wheel/trackpad, touch drag, or the arrow buttons (scroll-snap, no JS math of its own).
 */
export function PpiSlider({ t }: { t: PpiSliderStrings }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [disabled, setDisabled] = useState({ prev: true, next: false });

  // The arrows follow the visible slide. `round()` makes the last slide (shorter
  // than the viewport) report the same index as the first shows after a hard right swipe.
  const sync = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const i = Math.min(
      COUNTRIES.length - 1,
      Math.max(0, Math.round(track.scrollLeft / Math.max(track.clientWidth, 1))),
    );
    setDisabled({ prev: i <= 0, next: i >= COUNTRIES.length - 1 });
  }, []);

  useEffect(() => {
    sync();
  }, [sync]);

  const step = (delta: -1 | 1) => {
    const track = trackRef.current;
    if (!track) return;
    // Scroll to the exact snap position: relative smooth scrollBy gets swallowed by
    // mandatory scroll-snap in some browsers, so jump to the neighbouring slide.
    const next = Math.min(
      COUNTRIES.length - 1,
      Math.max(0, Math.round(track.scrollLeft / Math.max(track.clientWidth, 1)) + delta),
    );
    track.scrollTo({ left: next * track.clientWidth, behavior: "smooth" });
  };

  return (
    <section className="ppi-slider" aria-label={t.previous} aria-roledescription="carousel">
      <div className="ppi-slider__track" ref={trackRef} onScroll={sync}>
        {COUNTRIES.map((country, i) => (
          <article
            className="ppi-slider__slide"
            key={country.name}
            aria-label={`${i + 1} / ${COUNTRIES.length}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- static local photos, same as the logo */}
            <img
              className="ppi-slider__photo"
              src={`/home/${i + 1}.png`}
              alt={country.name}
              loading="lazy"
            />
            <div className="ppi-slider__veil" aria-hidden="true" />
            <div className="ppi-slider__panels">
              {i > 0 && (
                <div className="ppi-slider__ghost" aria-hidden="true">
                  {/* i > 0 guarantees `i - 1` is a valid index; `!` narrows it */}
                  <SlideContent country={COUNTRIES[i - 1]!} />
                </div>
              )}
              <div className="ppi-slider__panel">
                <SlideContent country={country} />
              </div>
            </div>
          </article>
        ))}
      </div>
      <button
        className="ppi-slider__arrow ppi-slider__arrow--prev"
        type="button"
        aria-label={t.previous}
        disabled={disabled.prev}
        onClick={() => step(-1)}
      >
        ‹
      </button>
      <button
        className="ppi-slider__arrow ppi-slider__arrow--next"
        type="button"
        aria-label={t.next}
        disabled={disabled.next}
        onClick={() => step(1)}
      >
        ›
      </button>
    </section>
  );
}
