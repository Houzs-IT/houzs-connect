"use client";

// A curated emoji grid, deliberately hand-rolled.
//
// No library and no remote asset on purpose: this ships to a Cloudflare Worker
// under a strict CSP, so an emoji-mart-style package (hundreds of KB of JSON) or
// a sprite sheet fetched from a CDN are both non-starters. These are plain
// Unicode characters rendered by the reader's own system font — nothing to
// download, nothing to allow-list.

import { useState } from "react";

interface Group {
  key: string;
  /** The tab label — an emoji from the group itself, so no icon set is needed. */
  icon: string;
  title: string;
  emoji: string[];
}

const GROUPS: Group[] = [
  {
    key: "smileys",
    icon: "🙂",
    title: "Smileys",
    emoji: [
      "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "🙂", "🙃",
      "😉", "😊", "😇", "🥰", "😍", "😘", "😗", "😋", "😜", "🤪",
      "🤗", "🤔", "🤨", "😐", "😑", "😶", "🙄", "😏", "😴", "😪",
      "😌", "😔", "😕", "🙁", "☹️", "😮", "😯", "😲", "😳", "🥺",
      "😢", "😭", "😤", "😠", "😡", "🤯", "😱", "😨", "😰", "😥",
      "🤝", "🙏", "😎", "🤓", "🥳", "😷", "🤒", "🤕", "🤢", "🤮",
    ],
  },
  {
    key: "gestures",
    icon: "👍",
    title: "Gestures",
    emoji: [
      "👍", "👎", "👌", "✌️", "🤞", "🤙", "👏", "🙌", "👐", "🤲",
      "💪", "👀", "👋", "🤚", "🖐️", "✋", "👊", "✊", "☝️", "👆",
      "👇", "👈", "👉", "✍️", "🫶", "🤟", "💅", "🦾", "🧠", "👂",
    ],
  },
  {
    key: "hearts",
    icon: "❤️",
    title: "Hearts",
    emoji: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔",
      "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💯", "✨",
      "⭐", "🌟", "💫", "🔥", "🎉", "🎊", "🥂", "🎁", "🏆", "🎯",
    ],
  },
  {
    key: "people",
    icon: "🧑",
    title: "People",
    emoji: [
      "👶", "🧒", "👦", "👧", "🧑", "👨", "👩", "🧓", "👴", "👵",
      "🧑‍💼", "👨‍💼", "👩‍💼", "🧑‍🔧", "👨‍🔧", "👩‍🔧", "🧑‍🍳", "🧑‍🏭", "🧑‍💻", "🚚",
      "👪", "🧑‍🤝‍🧑", "🙋", "🙆", "🙇", "🤷", "🤦", "💁", "🫡", "🕺",
    ],
  },
  {
    key: "home",
    icon: "🛋️",
    title: "Home",
    emoji: [
      "🛋️", "🪑", "🛏️", "🚪", "🪟", "🪞", "🧺", "🧹", "🧽", "🧼",
      "🏠", "🏡", "🏢", "🏬", "🏭", "🏗️", "🪚", "🔨", "🔧", "🪛",
      "🪵", "📏", "📐", "🧵", "🪡", "🧶", "🖼️", "💡", "🔌", "🧯",
    ],
  },
  {
    key: "objects",
    icon: "📦",
    title: "Objects",
    emoji: [
      "📦", "📬", "📮", "📝", "📄", "📃", "📑", "📊", "📈", "📉",
      "📅", "📆", "🗓️", "📌", "📎", "🔖", "🔍", "🔎", "🔒", "🔓",
      "🔑", "💳", "💰", "💵", "🧾", "🛒", "🛍️", "📞", "📱", "💻",
      "🖨️", "⌚", "📷", "🔋", "⚙️", "🧰", "📡", "🗂️", "🗑️", "✂️",
    ],
  },
  {
    key: "travel",
    icon: "🚚",
    title: "Travel",
    emoji: [
      "🚚", "🚛", "🚐", "🚗", "🚕", "🏍️", "🛵", "🚲", "✈️", "🚢",
      "⛴️", "🚀", "🛬", "🛫", "🗺️", "🧭", "📍", "🚦", "🛣️", "⛽",
      "🏁", "⏱️", "⏰", "⌛", "🕐", "📶", "🌐", "🏙️", "🌆", "🌉",
    ],
  },
  {
    key: "food",
    icon: "🍽️",
    title: "Food",
    emoji: [
      "🍽️", "☕", "🍵", "🧋", "🥤", "🍺", "🍻", "🥂", "🍰", "🎂",
      "🍪", "🍩", "🍞", "🥐", "🍕", "🍔", "🍟", "🌭", "🍜", "🍣",
      "🍱", "🍛", "🍚", "🥗", "🍎", "🍊", "🍌", "🍇", "🍉", "🥭",
    ],
  },
  {
    key: "symbols",
    icon: "✅",
    title: "Symbols",
    emoji: [
      "✅", "☑️", "✔️", "❌", "❎", "⚠️", "❗", "❓", "‼️", "⁉️",
      "🔴", "🟠", "🟡", "🟢", "🔵", "🟣", "⚫", "⚪", "🔺", "🔻",
      "➡️", "⬅️", "⬆️", "⬇️", "🔁", "🔄", "🆕", "🆓", "🔝", "🈵",
      "©️", "®️", "™️", "💬", "💭", "🗯️", "🔔", "🔕", "📢", "📣",
    ],
  },
];

/**
 * Insert-at-caret emoji grid. `onPick` gets the character; the composer owns
 * where it lands, because only it knows the textarea's selection.
 */
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  // Initial value in the initialiser, NOT in an effect — a setState inside a
  // useEffect is a lint failure in this repo, twice over.
  const [group, setGroup] = useState(GROUPS[0].key);
  const active = GROUPS.find((g) => g.key === group) ?? GROUPS[0];

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap gap-0.5 border-b border-[var(--color-border)] pb-1.5">
        {GROUPS.map((g) => (
          <button
            key={g.key}
            type="button"
            title={g.title}
            aria-label={g.title}
            aria-pressed={g.key === active.key}
            onClick={() => setGroup(g.key)}
            className={`grid h-7 w-7 place-items-center rounded-lg text-[15px] transition-colors ${
              g.key === active.key
                ? "bg-[var(--color-accent-soft)]"
                : "hover:bg-[var(--color-surface-2)]"
            }`}
          >
            {g.icon}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-10 gap-0.5">
        {active.emoji.map((e) => (
          <button
            key={`${active.key}-${e}`}
            type="button"
            onClick={() => onPick(e)}
            className="grid h-7 w-7 place-items-center rounded-lg text-[17px] leading-none hover:bg-[var(--color-surface-2)]"
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
