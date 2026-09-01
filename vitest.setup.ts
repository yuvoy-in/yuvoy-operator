import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/*
  No MSW here, unlike the traveller app. Every API call in this portal happens
  on the server, inside a server component or a Server Action, so there is
  nothing for a jsdom test to intercept — the end-to-end suite is what
  exercises the API surface, against the real Next server with mocks running
  inside it. Unit tests here cover the pure logic that decides what a dock
  screen shows.
*/
afterEach(() => cleanup());
