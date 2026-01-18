import { ReactElement } from "react";
import { StageBase, StageResponse, InitialData, Message } from "@chub-ai/stages-ts";
import { LoadResponse } from "@chub-ai/stages-ts/dist/types/load";

/**
 * DATA STRUCTURES
 * Defines the shape of our spatial data.
 */

interface CharacterSpatialInfo {
    name: string;
    x: number; // Horizontal distance relative to user (0)
    y: number; // Vertical/Depth distance relative to user (0)
    status: string; // Short status description
}

interface SpatialPacket {
    characters: CharacterSpatialInfo[];
}

/***
 * MessageStateType
 * We persist the list of character positions here.
 ***/
type MessageStateType = {
    spatialData: SpatialPacket;
    lastUpdate: number; // Timestamp of last update
};

/***
 * ConfigType
 * Simple ON/OFF toggle for the system.
 ***/
type ConfigType = {
    isActive: boolean;
    // If true, suppresses debug/warning/error console output from this stage.
    suppressLogs?: boolean;
};

type InitStateType = unknown;
type ChatStateType = unknown;

// Using code fence style tags to avoid HTML rendering issues in chat
const SPATIAL_TAG_OPEN = "```spatial_json";
const SPATIAL_TAG_CLOSE = "```";

/**
 * Try a strict JSON parse first, then attempt a few lenient fixes for
 * common model output problems (single quotes, trailing commas, stray
 * surrounding text). Returns parsed object or null if still invalid.
 */
function tryParseLenient(jsonStr: string): SpatialPacket | null {
    try {
        return JSON.parse(jsonStr);
    } catch (e1) {
        try {
            let s = jsonStr.trim();
            // Normalize newlines/spacing
            s = s.replace(/\r?\n/g, ' ');
            // Replace single quotes with double quotes (common LLM output)
            s = s.replace(/'/g, '"');
            // Remove trailing commas before closing braces/brackets
            s = s.replace(/,\s*([}\]])/g, '$1');
            // Extract first {...} block if there is surrounding junk
            const first = s.indexOf('{');
            const last = s.lastIndexOf('}');
            if (first !== -1 && last !== -1 && last > first) {
                s = s.substring(first, last + 1);
            }
            return JSON.parse(s);
        } catch (e2) {
            console.error('Spatial System: JSON parsing failed after lenient attempts', {
                originalError: e1,
                lenientError: e2,
                input: jsonStr.substring(0, 100) + (jsonStr.length > 100 ? '...' : '')
            });
            return null;
        }
    }
}

/**
 * Validates spatial coordinates and ensures they are within reasonable bounds
 */
function validateCoordinates(x: number, y: number): { x: number, y: number, valid: boolean } {
    // Define reasonable bounds for spatial coordinates
    const MAX_COORDINATE = 1000;
    const MIN_COORDINATE = -1000;

    if (isNaN(x) || isNaN(y)) {
        return { x: 0, y: 0, valid: false };
    }

    // Clamp coordinates to reasonable bounds
    x = Math.max(MIN_COORDINATE, Math.min(MAX_COORDINATE, x));
    y = Math.max(MIN_COORDINATE, Math.min(MAX_COORDINATE, y));

    return { x, y, valid: true };
}

export class Stage extends StageBase<InitStateType, ChatStateType, MessageStateType, ConfigType> {

    // Internal ephemeral state to hold the data for rendering
    myInternalState: MessageStateType;
    config: ConfigType;

    constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {
        super(data);
        const { messageState, config } = data;

        // Store config for access in hooks; apply sensible defaults
        const defaultConfig: ConfigType = { isActive: true, suppressLogs: false };
        this.config = { ...defaultConfig, ...(config || {}) };

        // Initialize state if it doesn't exist
        this.myInternalState = messageState || {
            spatialData: { characters: [] },
            lastUpdate: Date.now()
        };
    }

    async load(): Promise<Partial<LoadResponse<InitStateType, ChatStateType, MessageStateType>>> {
        return {
            success: true,
            error: null,
            initState: null,
            chatState: null,
        };
    }

    async setState(state: MessageStateType): Promise<void> {
        // Called when browsing history/swiping. We must update our internal view.
        if (state) {
            this.myInternalState = state;
        }
    }

    /***
     * BEFORE PROMPT
     * Inject the instructions to the LLM to generate the JSON.
     ***/
    async beforePrompt(userMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
        // Log the user message for debugging purposes (only in development)
        if (!this.config?.suppressLogs && (import.meta as any).env.MODE === 'development') {
            console.debug('Spatial System: Processing user message', { content: userMessage.content });
        }

        // If the stage is turned off in config, do nothing.
        if (this.config?.isActive === false) {
            return {};
        }

        // The prompt injection to force the AI to maintain the spatial system.
        const systemInstruction = `
[SYSTEM: SPATIAL TRACKING ACTIVE]
You must maintain a spatial tracking system for this scene. 
{{user}} is at coordinates (0,0).
Analyze the scene and determine the coordinates (X, Y) and a short "Status" for every other character present relative to {{user}}.
- X: Horizontal distance (negative = left, positive = right).
- Y: Forward distance (negative = behind, positive = in front).

Output the result strictly as a valid JSON object wrapped in ${SPATIAL_TAG_OPEN} tags at the very end of your response.
Format:
${SPATIAL_TAG_OPEN}
{
  "characters": [
    { "name": "{{char}}", "x": 5, "y": 10, "status": "Walking towards user" }
  ]
}
${SPATIAL_TAG_CLOSE}
Ensure valid JSON. Do not output this text outside the tags.
`;

        return {
            // We append this as a system message so the AI sees it as an instruction, 
            // but it's not put into the user's mouth.
            systemMessage: systemInstruction,
            messageState: this.myInternalState, // Pass current state forward
        };
    }

    /***
     * AFTER RESPONSE
     * Parse the JSON from the AI, update state, and clean the message.
     ***/
    async afterResponse(botMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
        if (this.config?.isActive === false) {
            return {};
        }

        const content = botMessage.content;
        let finalContent = content;
        const newState = { ...this.myInternalState };

        // Regex to capture content between the tags (dotall mode to catch newlines)
        // Escape backticks for regex pattern
        const escapedOpen = SPATIAL_TAG_OPEN.replace(/`/g, '\\`');
        const escapedClose = SPATIAL_TAG_CLOSE.replace(/`/g, '\\`');
        const regex = new RegExp(`${escapedOpen}([\\s\\S]*?)${escapedClose}`);
        const match = content.match(regex);

        if (match && match[1]) {
            const jsonStr = match[1].trim();
            const parsedData: SpatialPacket | null = tryParseLenient(jsonStr);

            if (!parsedData) {
                // Parsing failed even after lenient attempts — surface as an error once to help debugging.
                if (!this.config?.suppressLogs) {
                    console.error("Spatial System: Failed to parse AI JSON after lenient attempts", { raw: jsonStr });
                }
            } else {
                // Validate and deduplicate characters (last occurrence wins)
                if (parsedData.characters && Array.isArray(parsedData.characters)) {
                    const deduplicatedChars: CharacterSpatialInfo[] = [];
                    const seenNames = new Set<string>();

                    // Process in reverse to keep last occurrence
                    for (let i = parsedData.characters.length - 1; i >= 0; i--) {
                        const char = parsedData.characters[i];
                        if (char && char.name && !seenNames.has(char.name)) {
                            // Parse and validate coordinates
                            const parsedX = typeof char.x === 'number' ? char.x : (typeof char.x === 'string' ? parseFloat(char.x) : 0);
                            const parsedY = typeof char.y === 'number' ? char.y : (typeof char.y === 'string' ? parseFloat(char.y) : 0);

                            const { x, y, valid } = validateCoordinates(parsedX, parsedY);

                            if (valid) {
                                deduplicatedChars.unshift({
                                    name: char.name,
                                    x: x,
                                    y: y,
                                    status: char.status || 'unknown'
                                });
                                seenNames.add(char.name);
                            } else {
                                // Use debug instead of warn to reduce console noise in normal operation.
                                if (!this.config?.suppressLogs) {
                                    console.debug(`Spatial System: Invalid coordinates for character "${char.name}" (clamped to bounds)`, {
                                        original: { x: parsedX, y: parsedY },
                                        clamped: { x, y }
                                    });
                                }
                            }
                        }
                    }

                    parsedData.characters = deduplicatedChars;
                }

                // Update our state with the new data
                newState.spatialData = parsedData;
                newState.lastUpdate = Date.now();

                // Update internal state immediately for responsiveness
                this.myInternalState = newState;

                // Remove the hidden block from the visible message
                finalContent = content.replace(regex, "").trim();
            }
        }

        return {
            messageState: newState,
            modifiedMessage: finalContent, // This cleans the chat bubble!
        };
    }

    render(): ReactElement {
        return <SpatialDisplay state={this.myInternalState} />;
    }
}

/***
 * COMPONENT: SpatialDisplay
 * A clean UI to show the "Note of status" and invisible grid data.
 ***/
const SpatialDisplay = ({ state }: { state: MessageStateType }) => {
    // We use a little React hook to force a re-render if the state object changes deeply
    // though typically the parent render calls this with new props.

    const chars = state.spatialData?.characters || [];

    return (
        <div style={{
            width: '100vw',
            height: '100vh',
            backgroundColor: '#1a1a1a', // Dark theme background
            color: '#e0e0e0',
            fontFamily: 'monospace',
            padding: '20px',
            boxSizing: 'border-box',
            overflowY: 'auto'
        }}>
            <h2 style={{ borderBottom: '1px solid #444', paddingBottom: '10px' }}>
                Spatial Status Monitor
            </h2>

            {chars.length === 0 ? (
                <p style={{ color: '#888' }}>No spatial data tracking yet. Start chatting!</p>
            ) : (
                <div style={{ display: 'grid', gap: '15px' }}>
                    {chars.map((char, idx) => (
                        <div key={idx} style={{
                            background: '#2a2a2a',
                            padding: '15px',
                            borderRadius: '8px',
                            borderLeft: '4px solid #4caf50'
                        }}>
                            <div style={{ fontSize: '1.2em', fontWeight: 'bold', marginBottom: '5px' }}>
                                {char.name}
                            </div>
                            <div style={{ fontSize: '0.9em', color: '#aaa', marginBottom: '10px' }}>
                                Status: <span style={{ color: '#fff' }}>{char.status}</span>
                            </div>
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: '1fr 1fr',
                                background: '#111',
                                padding: '10px',
                                borderRadius: '4px'
                            }}>
                                <div><span style={{ color: '#f88' }}>X (Right/Left):</span> {char.x}</div>
                                <div><span style={{ color: '#88f' }}>Y (Front/Back):</span> {char.y}</div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div style={{ marginTop: '20px', fontSize: '0.8em', color: '#555' }}>
                * Grid Center (0,0) is User.
            </div>
        </div>
    );
};
