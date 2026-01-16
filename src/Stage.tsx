import { ReactElement, useState, useEffect } from "react";
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
};

type InitStateType = any;
type ChatStateType = any;

const SPATIAL_TAG_OPEN = "<spatial_system>";
const SPATIAL_TAG_CLOSE = "</spatial_system>";

export class Stage extends StageBase<InitStateType, ChatStateType, MessageStateType, ConfigType> {

    // Internal ephemeral state to hold the data for rendering
    myInternalState: MessageStateType;

    constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {
        super(data);
        const { messageState, config } = data;

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
        // If the stage is turned off in config, do nothing.
        if (this.data.config?.isActive === false) {
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
        if (this.data.config?.isActive === false) {
            return {};
        }

        const content = botMessage.content;
        let finalContent = content;
        let newState = { ...this.myInternalState };

        // Regex to capture content between the tags (dotall mode to catch newlines)
        const regex = new RegExp(`${SPATIAL_TAG_OPEN}([\\s\\S]*?)${SPATIAL_TAG_CLOSE}`);
        const match = content.match(regex);

        if (match && match[1]) {
            try {
                const jsonStr = match[1].trim();
                const parsedData: SpatialPacket = JSON.parse(jsonStr);

                // Update our state with the new data
                newState.spatialData = parsedData;
                newState.lastUpdate = Date.now();

                // Update internal state immediately for responsiveness
                this.myInternalState = newState;

                // Remove the hidden block from the visible message
                finalContent = content.replace(regex, "").trim();

            } catch (e) {
                console.error("Spatial System: Failed to parse AI JSON", e);
                // If parsing fails, we don't crash, we just don't update state.
                // We typically leave the message alone so the user can see the raw output to debug,
                // or you could strip it anyway. Let's leave it for debugging if it fails.
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
                                <div><span style={{color:'#f88'}}>X (Right/Left):</span> {char.x}</div>
                                <div><span style={{color:'#88f'}}>Y (Front/Back):</span> {char.y}</div>
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
