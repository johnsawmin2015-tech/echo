import { useEffect, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as SQLite from "expo-sqlite";
import { createId, runPipeline } from "../../packages/core/src/index.ts";

type Entry = {
  id: string;
  original_content: string;
  created_at: string;
  translation: string | null;
  topics_json: string;
  processing_status: string;
};

type Screen = "home" | "write";

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("Ready");
  const [themes, setThemes] = useState(true);

  async function database() {
    const db = await SQLite.openDatabaseAsync("echo.db");
    await db.execAsync(`CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      original_content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      translation TEXT,
      topics_json TEXT NOT NULL,
      processing_status TEXT NOT NULL
    )`);
    return db;
  }

  async function refresh() {
    const db = await database();
    setEntries(await db.getAllAsync<Entry>("SELECT * FROM entries ORDER BY created_at DESC"));
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function save() {
    const content = draft.trim();
    if (!content) {
      setStatus("Write something before saving.");
      return;
    }
    setStatus("Saved");
    const db = await database();
    const id = createId();
    const createdAt = new Date().toISOString();
    await db.runAsync(
      "INSERT INTO entries (id, original_content, created_at, translation, topics_json, processing_status) VALUES (?, ?, ?, NULL, '[]', 'pending')",
      id,
      content,
      createdAt,
    );
    setDraft("");
    setScreen("home");
    await refresh();
    const result = runPipeline({ originalContent: content, emotionalContextEnabled: themes });
    const translation = result.translation.text && result.translation.text !== content ? result.translation.text : null;
    await db.runAsync(
      "UPDATE entries SET translation = ?, topics_json = ?, processing_status = ? WHERE id = ? AND original_content = ?",
      translation,
      JSON.stringify(result.topics.items ?? []),
      result.translation.status === "failed" ? "partial" : "ready",
      id,
      content,
    );
    await refresh();
  }

  return (
    <SafeAreaView style={styles.page}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.brand}>Echo</Text>
        <Text style={styles.quiet}>{status}</Text>
      </View>
      {screen === "home" ? (
        <ScrollView contentContainerStyle={styles.body}>
          <Pressable style={styles.primary} onPress={() => setScreen("write")} accessibilityRole="button">
            <Text style={styles.primaryText}>Write</Text>
          </Pressable>
          {entries.length === 0 ? <Text style={styles.quiet}>Nothing written yet.</Text> : entries.map((entry) => (
            <View key={entry.id} style={styles.card}>
              <Text style={styles.original}>{entry.original_content}</Text>
              {entry.translation ? <Text style={styles.translation}>{entry.translation}</Text> : null}
              <Text style={styles.quiet}>{entry.processing_status}</Text>
            </View>
          ))}
          <Pressable onPress={() => setThemes((value) => !value)} accessibilityRole="switch" accessibilityState={{ checked: themes }}>
            <Text>{themes ? "Emotional themes on" : "Emotional themes off"}</Text>
          </Pressable>
        </ScrollView>
      ) : (
        <View style={styles.body}>
          <TextInput
            style={styles.input}
            multiline
            value={draft}
            onChangeText={setDraft}
            placeholder="Write in Burmese, English, or both."
            accessibilityLabel="Original"
          />
          <Pressable style={styles.primary} onPress={() => void save()} accessibilityRole="button">
            <Text style={styles.primaryText}>Save</Text>
          </Pressable>
          <Pressable onPress={() => setScreen("home")} accessibilityRole="button">
            <Text>Back</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#E7E1D6" },
  header: { padding: 20, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  brand: { fontSize: 32, color: "#1C1915" },
  body: { padding: 20, gap: 14 },
  primary: { backgroundColor: "#1E3B31", minHeight: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "white", fontSize: 16 },
  card: { backgroundColor: "#FBFAF6", borderRadius: 16, padding: 16, gap: 8 },
  original: { fontSize: 18, color: "#1C1915" },
  translation: { fontSize: 16, color: "#5E584E" },
  quiet: { color: "#5E584E" },
  input: { minHeight: 220, fontSize: 20, color: "#1C1915", textAlignVertical: "top" },
});
