# ChubAI Spatial System - AI Agent Instructions

## Project Overview
A **Stage-based plugin system** for ChubAI that tracks character spatial positions relative to the user during roleplay conversations. The system integrates with the `@chub-ai/stages-ts` framework to inject spatial-tracking instructions into LLM prompts, parse JSON responses, and maintain a persistent state of character coordinates.

## Architecture & Data Flow

### Core Components
- **Stage.tsx**: Main plugin extending `StageBase<InitStateType, ChatStateType, MessageStateType, ConfigType>`
  - `MessageStateType`: Holds `SpatialPacket` (array of characters with x/y coords) + `lastUpdate` timestamp + `lastWarnings`
  - `ConfigType`: Simple `{ isActive: boolean }` toggle
  
- **SpatialDisplay Component**: Dark-themed UI rendering character positions in a grid layout

### Three Critical Lifecycle Hooks
1. **`beforePrompt()`**: Injects system instruction forcing AI to output spatial JSON between `<spatial_system>` tags
2. **`afterResponse()`**: Extracts JSON using regex, updates state via `applySpatialUpdate()`, strips tags from chat bubble
3. **`render()`**: Returns `SpatialDisplay` component with current state

## Key Patterns & Conventions

### Data Validation & Coercion
- All numeric inputs pass through `coerceNumber()` (accepts number | string parseable as number)
- Coordinates clamped to ±10,000 range via `clampNumber()`
- Character limit: 200 max; excess trimmed with warning
- Numbers are validated before use; invalid data skipped with warning

### JSON Extraction Strategy
- Uses **global regex with `matchAll()`** to handle multiple tag pairs; **prefers last valid block** if AI outputs tags multiple times
- Regex pattern: `` `${SPATIAL_TAG_OPEN}([\\s\\S]*?)${SPATIAL_TAG_CLOSE}` `` with global flag
- Parsing failures logged but don't crash; message left unmodified for user debugging
- Extracts last match: `matches[matches.length - 1][1]`

### State Management
- State persists across message history swaps via `setState()` hook
- `lastUpdate` timestamp updated on every successful parse
- `lastWarnings` array accumulated for debugging; displayed in UI with orange styling
- Deduplication by character name (last occurrence wins)

### Configuration
- Entire system toggled by `config.isActive` boolean
- When disabled, hooks return empty objects (no-op)

## Development Workflow

### Testing
- **TestRunner.tsx**: Local testing outside active chat
  - Loads test data from `assets/test-init.json`
  - Main hook: `runTests()` function - uncomment/modify test cases there
  - Uses `DEFAULT_MESSAGE`, `DEFAULT_INITIAL` constants for forwards compatibility with library updates

### Build & Environment
- **Vite-based** project
- Dev mode: runs `TestStageRunner`; Production: runs `ReactRunner`
- Toggle via `import.meta.env.MODE`
- No strict mode enabled in dev (disabled for stages)

### Data Format for Testing
- `test-init.json` conforms to Chub.ai character/user schema with fields: name, description, personality, first_message, scenario, etc.
- Test data includes sample "Janessa" character for validation

## Integration Points

### With @chub-ai/stages-ts
- Inherits from `StageBase<Init, Chat, Message, Config>` (4-type generics required)
- Implements required methods: `load()`, `setState()`, `beforePrompt()`, `afterResponse()`, `render()`
- Uses `Message` type for bot/user messages; `StageResponse` for hook returns
- Import `LoadResponse` from `dist/types/load`

### Message Cleaning
- `modifiedMessage` return field in `afterResponse()` strips spatial tags from visible chat
- Uses: `content.replace(regex, '').trim()`

## Common Tasks

### Adding New Character Fields
1. Extend `CharacterSpatialInfo` interface with new field
2. Update `applySpatialUpdate()` to handle parsing and assignment (follow conditional pattern for x/y)
3. Update `SpatialDisplay` grid rendering to display the field
4. Update system prompt example JSON if relevant

### Adjusting Coordinate Limits
- `COORD_CLAMP` constant: sets ±limit for coordinates (currently 10,000)
- `MAX_CHARACTERS`: character array size limit (currently 200)

### Modifying System Prompt
- Edit `systemInstruction` string in `beforePrompt()`
- Preserve `${SPATIAL_TAG_OPEN}` / `${SPATIAL_TAG_CLOSE}` tokens for regex matching
- Keep JSON format example in instructions for AI clarity
- Mention that X/Y are relative to user at (0,0)

## Important Caveats

- **No persistence layer**: Spatial data exists only in browser memory during session
- **Last-one-wins deduplication**: If incoming JSON has duplicate character names, the last occurrence is kept
- **Partial updates supported**: Characters can update only some fields (x, y, status); existing values not reset
- **Warning accumulation**: `lastWarnings` may grow; UI shows all but consider lifecycle management
- **Regex preference**: If AI outputs multiple `<spatial_system>` blocks, the last valid JSON is used
- **String coercion**: x/y can be strings like "5.5" and will parse; non-numeric strings are rejected with warning
