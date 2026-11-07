// Runs before every unit test file: unmount what a test rendered, so tests don't see each other.
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());
