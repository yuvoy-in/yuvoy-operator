import { describe, expect, it } from "vitest";
import {
  activityChoices,
  CATEGORIES,
  categoryChoices,
  destinationChoices,
  isCategory,
  marketName,
  type Vocabulary,
} from "./vocabulary";

const vocabulary: Vocabulary = {
  market: { key: "andaman", name: "Andaman Islands" },
  categories: [
    { key: "adventure", label: "Adventure" },
    { key: "nature_wildlife", label: "Nature & wildlife" },
  ],
  destinations: [
    { key: "andaman/havelock", label: "Havelock (Swaraj Dweep)" },
    { key: "andaman/neil", label: "Neil (Shaheed Dweep)" },
  ],
};

describe("the category picker", () => {
  it("offers every value the API accepts, whatever the vocabulary carried", () => {
    /*
      Built from the request body's ENUM and merely labelled from the response.
      Driving the list from the response would let a slow or failed read empty
      a picker whose values are known at compile time — and an operator cannot
      create a listing without choosing one.
    */
    expect(categoryChoices(vocabulary)).toHaveLength(CATEGORIES.length);
    expect(categoryChoices(null)).toHaveLength(CATEGORIES.length);
  });

  it("uses the server's label when it has one", () => {
    const choices = categoryChoices(vocabulary);
    expect(choices.find((c) => c.value === "nature_wildlife")?.label).toBe(
      "Nature & wildlife",
    );
  });

  it("falls back to a readable key rather than showing nothing", () => {
    /*
      An ugly name beats an absent option. Showing a category the API would
      accept is never worse than hiding it because a label did not arrive.
    */
    expect(
      categoryChoices(null).find((c) => c.value === "nature_wildlife")?.label,
    ).toBe("Nature wildlife");
    expect(categoryChoices(null).find((c) => c.value === "events")?.label).toBe(
      "Events",
    );
  });

  it("ignores a term the enum does not contain", () => {
    /*
      The enum wins. Offering a category the request body would refuse turns a
      picker into a 400 the operator meets after filling the form in — which is
      the exact failure the picker replaced.
    */
    const withStray: Vocabulary = {
      ...vocabulary,
      categories: [
        ...(vocabulary.categories ?? []),
        { key: "hot_air_ballooning", label: "Hot air ballooning" },
      ],
    };
    const values = categoryChoices(withStray).map((c) => c.value);
    expect(values).not.toContain("hot_air_ballooning");
    expect(values).toHaveLength(CATEGORIES.length);
  });

  it("survives a term with a key and no label", () => {
    const partial: Vocabulary = {
      ...vocabulary,
      categories: [{ key: "adventure" }],
    };
    expect(
      categoryChoices(partial).find((c) => c.value === "adventure")?.label,
    ).toBe("Adventure");
  });
});

describe("the destination picker", () => {
  it("comes from the response, because these are rows and not an enum", () => {
    // "There is no enum here to go stale." So unlike categories, the list
    // itself has to be the server's.
    expect(destinationChoices(vocabulary).map((d) => d.value)).toEqual([
      "andaman/havelock",
      "andaman/neil",
    ]);
  });

  it("keeps the server's order rather than sorting it", () => {
    /*
      It is "the order a picker should show them". Sorting alphabetically here
      would throw away whatever that ordering means — which market opened
      first, which is busiest, or simply which we want tried.
    */
    const reversed: Vocabulary = {
      ...vocabulary,
      destinations: [
        { key: "andaman/port_blair", label: "Port Blair" },
        { key: "andaman/havelock", label: "Havelock (Swaraj Dweep)" },
      ],
    };
    expect(destinationChoices(reversed).map((d) => d.label)).toEqual([
      "Port Blair",
      "Havelock (Swaraj Dweep)",
    ]);
  });

  it("is empty rather than invented when no destination is open", () => {
    // "Empty means we have not opened one yet, which is a state worth
    // rendering rather than a failure."
    expect(destinationChoices({ ...vocabulary, destinations: [] })).toEqual([]);
    expect(destinationChoices(null)).toEqual([]);
  });

  it("shows a key readably if the label is missing", () => {
    const noLabel: Vocabulary = {
      ...vocabulary,
      destinations: [{ key: "andaman/long_island" }],
    };
    expect(destinationChoices(noLabel)[0].label).toBe("Andaman/long island");
  });

  it("drops a row with no key, which nothing could submit", () => {
    const broken: Vocabulary = {
      ...vocabulary,
      destinations: [{ label: "Nowhere" }, { key: "andaman/neil" }],
    };
    expect(destinationChoices(broken).map((d) => d.value)).toEqual([
      "andaman/neil",
    ]);
  });
});

describe("the market", () => {
  it("is named, so an empty destination list can say where", () => {
    expect(marketName(vocabulary)).toBe("Andaman Islands");
  });

  it("is null rather than a guess when the read failed", () => {
    expect(marketName(null)).toBeNull();
  });
});

describe("the category guard", () => {
  it("accepts only what the contract enumerates", () => {
    expect(isCategory("adventure")).toBe(true);
    expect(isCategory("local_life")).toBe(true);
    expect(isCategory("hot_air_ballooning")).toBe(false);
    expect(isCategory("")).toBe(false);
  });
});

describe("what a listing actually is", () => {
  /*
    yuvoy-operator#30 §2. The twelve categories are market-agnostic, so in the
    Andamans every water sport is `adventure` — and that stopped being merely
    imprecise when credential requirements moved to resolve per activity type.
  */
  const vocab = {
    activityTypes: [
      { key: "scuba", label: "Scuba diving", category: "adventure" },
      {
        key: "birdwatching",
        label: "Birdwatching",
        category: "nature_wildlife",
      },
    ],
  } as unknown as Parameters<typeof activityChoices>[0];

  it("narrows to the chosen category", () => {
    /*
      The pair is enforced by a composite foreign key — `scuba` under
      `food_drink` is a 400 — so offering the wrong ones only moves the refusal
      to after the form is filled in.
    */
    expect(activityChoices(vocab, "adventure").map((c) => c.value)).toEqual([
      "scuba",
    ]);
    expect(
      activityChoices(vocab, "nature_wildlife").map((c) => c.value),
    ).toEqual(["birdwatching"]);
  });

  it("offers nothing before a category is chosen", () => {
    // An unfiltered list would let somebody pick a pair the API refuses.
    expect(activityChoices(vocab, null)).toEqual([]);
  });

  it("offers nothing for a category with no activities", () => {
    expect(activityChoices(vocab, "food_drink")).toEqual([]);
  });

  it("survives a vocabulary read that failed", () => {
    // The create form degrades to what it can still do rather than showing an
    // empty control.
    expect(activityChoices(null, "adventure")).toEqual([]);
  });
});
