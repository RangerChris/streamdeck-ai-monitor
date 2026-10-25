import streamDeck from "@elgato/streamdeck";

import { ClaudeUsage } from "./actions/claude-usage";
import { CurrentModel } from "./actions/current-model";
import { GroveAction } from "./actions/grove-action";
import { LiveSessions } from "./actions/live-sessions-action";
import { OllamaBalanceAction } from "./actions/ollama-balance";
import { OllamaInfobar } from "./actions/ollama-infobar";

// We can enable "trace" logging so that all messages between the Stream Deck, and the plugin are recorded. When storing sensitive information
streamDeck.logger.setLevel("trace");

// Register the actions.
streamDeck.actions.registerAction(new OllamaBalanceAction());
streamDeck.actions.registerAction(new OllamaInfobar());
streamDeck.actions.registerAction(new ClaudeUsage());
streamDeck.actions.registerAction(new LiveSessions());
streamDeck.actions.registerAction(new CurrentModel());
streamDeck.actions.registerAction(new GroveAction());

// Finally, connect to the Stream Deck.
streamDeck.connect();