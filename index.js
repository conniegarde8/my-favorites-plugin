// public/extensions/third-party/my-favorites-plugin/index.js

// Import from the core script (public/script.js)
import {
    saveSettingsDebounced,
    getCurrentChatId,
    eventSource,
    event_types,
    t,
    // messageFormatting, // Not strictly needed for basic preview, but could be used
} from '../../../../script.js';

// Import from the extension helper script (public/scripts/extensions.js)
import {
    getContext,
    renderExtensionTemplateAsync,
    extension_settings,
} from '../../../extensions.js';

// Import from the Popup utility script (public/scripts/popup.js)
import {
    Popup,
    POPUP_TYPE,
    callGenericPopup,
    POPUP_RESULT,
} from '../../../popup.js';

// Import from the general utility script (public/scripts/utils.js)
import {
    uuidv4,
    timestampToMoment,
} from '../../../utils.js';

// jQuery ($) is globally available

(function () { // Use IIFE to encapsulate plugin logic

    const pluginName = 'my-favorites-plugin';
    const pluginFolderName = 'my-favorites-plugin'; // Matches the actual folder name
    const logPrefix = `[${pluginName}]`;

    // --- Constants ---
    const favIconClass = 'favorite-toggle-icon';
    const favIconSelector = `.${favIconClass}`;
    const favoritedIconClass = 'fa-solid fa-star'; // Gold, solid star
    const unfavoritedIconClass = 'fa-regular fa-star'; // Hollow star
    const settingsContainerId = 'favorites-plugin-settings-area';
    const sidebarButtonId = 'my_favorites_sidebar_button';
    const popupListContainerId = 'favorites-popup-list-container';
    const popupPaginationId = 'favorites-popup-pagination';
    const pluginPageListContainerId = 'favorites-plugin-page-list';
    const pluginPagePaginationId = 'favorites-plugin-page-pagination';
    const itemsPerPagePopup = 10;
    const itemsPerPagePluginPage = 20;


    // --- HTML Snippets ---
    const messageButtonHtml = `
        <div class="mes_button ${favIconClass}" title="Favorite/Unfavorite Message">
            <i class="${unfavoritedIconClass}"></i>
        </div>
    `;

    // --- Global State ---
    let favoritesPopup = null; // Stores the Popup instance
    let currentPopupChatId = null; // Tracks which chat the popup is showing
    let currentPopupPage = 1;
    let currentPluginPagePage = 1;

    // --- Core Data Functions ---

    /**
     * Ensures the plugin's settings object exists.
     */
    function initializeSettings() {
        if (!extension_settings[pluginName]) {
            extension_settings[pluginName] = { chats: {} };
            console.log(logPrefix, 'Initialized settings.');
        }
        // Ensure 'chats' sub-object exists
        if (!extension_settings[pluginName].chats) {
            extension_settings[pluginName].chats = {};
        }
    }

    /**
     * Gets the plugin's settings object.
     * @returns {object} The plugin settings.
     */
    function getPluginSettings() {
        initializeSettings(); // Ensure it's initialized before accessing
        return extension_settings[pluginName];
    }

    /**
     * Gets chat info for the current context.
     * @returns {object|null} { chatId, type, name, characterId?, groupId? } or null if context unavailable.
     */
    function getCurrentChatInfo() {
        try {
            const context = getContext();
            const chatId = getCurrentChatId(); // From script.js
            if (!chatId) return null;

            let type, name, characterId, groupId;

            if (context.groupId) {
                type = "group";
                groupId = context.groupId;
                const group = context.groups ? context.groups.find(g => g.id === groupId) : null;
                name = group ? group.name : `Group ${groupId}`;
            } else if (context.characterId) {
                type = "private";
                characterId = context.characterId;
                name = context.name2; // Character name
            } else {
                // Fallback or unknown state
                console.warn(logPrefix, "Could not determine chat type for", chatId);
                return null;
            }

            return { chatId, type, name, characterId, groupId };
        } catch (error) {
            console.error(logPrefix, "Error getting current chat info:", error);
            return null;
        }
    }

     /**
     * Gets a specific chat message object from the current context.
     * @param {string|number} messageId The ID of the message to find.
     * @returns {object|null} The message object or null if not found.
     */
     function getChatMessageById(messageId) {
        try {
            const context = getContext();
            // Ensure messageId is parsed correctly if it's sometimes a string/number
            const targetId = typeof messageId === 'string' ? parseInt(messageId, 10) : messageId;
            return context.chat?.find(msg => msg.id === targetId) || null;
        } catch (error) {
            // console.warn(logPrefix, `Could not get message ${messageId} from context:`, error);
            return null;
        }
    }


    /**
     * Checks if a message is currently favorited.
     * @param {string} chatId The chat ID.
     * @param {string|number} messageId The message ID.
     * @returns {boolean} True if favorited, false otherwise.
     */
    function isFavorited(chatId, messageId) {
        const settings = getPluginSettings();
        const chatData = settings.chats[chatId];
        if (!chatData || !chatData.items) return false;
        // Ensure comparison handles potential type mismatches (string vs number)
        const stringMessageId = String(messageId);
        return chatData.items.some(item => String(item.messageId) === stringMessageId);
    }

    /**
     * Adds a message to favorites.
     * @param {object} chatInfo - Result from getCurrentChatInfo().
     * @param {object} message - The message object from context.chat.
     */
    function addFavorite(chatInfo, message) {
        if (!chatInfo || !message) {
            console.error(logPrefix, "addFavorite: Missing chatInfo or message object.");
            return;
        }
        const { chatId, type, name, characterId, groupId } = chatInfo;
        const settings = getPluginSettings();

        // Ensure chat entry exists
        if (!settings.chats[chatId]) {
            settings.chats[chatId] = {
                type: type,
                name: name,
                characterId: characterId,
                groupId: groupId,
                count: 0,
                items: [],
            };
            // Update name/type if it exists already but lacks details
        } else {
             settings.chats[chatId].name = name; // Keep name potentially updated
             settings.chats[chatId].type = type;
             if (characterId) settings.chats[chatId].characterId = characterId;
             if (groupId) settings.chats[chatId].groupId = groupId;
             if (!settings.chats[chatId].items) settings.chats[chatId].items = [];
             if (typeof settings.chats[chatId].count !== 'number') settings.chats[chatId].count = 0;
        }


        // Check if already favorited (shouldn't happen if UI logic is correct, but good safeguard)
        if (isFavorited(chatId, message.id)) {
            console.warn(logPrefix, `Message ${message.id} in chat ${chatId} is already favorited.`);
            return;
        }

        const newItem = {
            id: uuidv4(), // Unique favorite ID
            messageId: String(message.id), // Store as string for consistency
            sender: message.name,
            role: message.is_user ? "user" : (message.is_system ? "system" : "character"),
            timestamp: message.send_date, // Unix timestamp
            note: "", // Initialize note as empty
        };

        settings.chats[chatId].items.push(newItem);
        settings.chats[chatId].count = settings.chats[chatId].items.length; // Recalculate count

        console.log(logPrefix, `Favorited message ${message.id} in chat ${chatId}. New count: ${settings.chats[chatId].count}`);
        saveSettingsDebounced();

        // Update popup if it's open for this chat
        if (favoritesPopup && favoritesPopup.isShown() && currentPopupChatId === chatId) {
            updateFavoritesPopup(chatId, currentPopupPage); // Re-render popup
        }
         // Update plugin page if visible
        renderPluginPage();
    }

    /**
     * Removes a favorite by its unique favorite item ID.
     * @param {string} chatId The chat ID.
     * @param {string} favId The unique ID of the favorite item to remove.
     * @returns {boolean} True if removal was successful, false otherwise.
     */
    function removeFavoriteById(chatId, favId) {
        const settings = getPluginSettings();
        const chatData = settings.chats[chatId];

        if (!chatData || !chatData.items) {
            console.warn(logPrefix, `Cannot remove favorite: Chat ${chatId} not found or has no items.`);
            return false;
        }

        const initialLength = chatData.items.length;
        chatData.items = chatData.items.filter(item => item.id !== favId);
        const removed = chatData.items.length < initialLength;

        if (removed) {
            chatData.count = chatData.items.length;
            console.log(logPrefix, `Removed favorite ${favId} from chat ${chatId}. New count: ${chatData.count}`);

            // If chat becomes empty, remove the chat entry itself
            if (chatData.count === 0) {
                delete settings.chats[chatId];
                console.log(logPrefix, `Removed empty chat entry for ${chatId}.`);
            }
            saveSettingsDebounced();

            // Update popup if it's open for this chat
            if (favoritesPopup && favoritesPopup.isShown() && currentPopupChatId === chatId) {
                // Go back a page if the current page becomes empty, unless it's the first page
                 const totalPages = Math.ceil(chatData.count / itemsPerPagePopup);
                 if (currentPopupPage > totalPages && currentPopupPage > 1) {
                     currentPopupPage--;
                 }
                updateFavoritesPopup(chatId, currentPopupPage); // Re-render popup
            }
             // Update plugin page if visible
            renderPluginPage();

            return true;
        } else {
            console.warn(logPrefix, `Favorite with ID ${favId} not found in chat ${chatId}.`);
            return false;
        }
    }

    /**
     * Removes a favorite based on the original message ID.
     * @param {string} chatId The chat ID.
     * @param {string|number} messageId The original message ID.
     * @returns {boolean} True if removal was successful, false otherwise.
     */
     function removeFavoriteByMessageId(chatId, messageId) {
        const settings = getPluginSettings();
        const chatData = settings.chats[chatId];

        if (!chatData || !chatData.items) {
            // console.warn(logPrefix, `Cannot remove favorite by messageId: Chat ${chatId} not found or has no items.`);
            return false; // Not necessarily an error if toggling an unfavorited message
        }

        const stringMessageId = String(messageId);
        const favItem = chatData.items.find(item => String(item.messageId) === stringMessageId);

        if (favItem) {
            return removeFavoriteById(chatId, favItem.id);
        } else {
            // console.warn(logPrefix, `Favorite for message ID ${messageId} not found in chat ${chatId}.`);
            return false; // Not favorited in the first place
        }
    }


    // --- UI Update Functions ---

    /**
     * Updates the visual state of a favorite icon on a specific message.
     * @param {jQuery} $messageElement - The jQuery object for the message container (.mes).
     * @param {boolean} isFav - True to show favorited state, false for default.
     */
    function updateFavoriteIconState($messageElement, isFav) {
        const $icon = $messageElement.find(favIconSelector + ' i');
        if ($icon.length) {
            if (isFav) {
                $icon.removeClass(unfavoritedIconClass).addClass(favoritedIconClass);
                $icon.closest(favIconSelector).attr('title', 'Unfavorite Message');
            } else {
                $icon.removeClass(favoritedIconClass).addClass(unfavoritedIconClass);
                 $icon.closest(favIconSelector).attr('title', 'Favorite Message');
            }
        } else {
             // console.warn(logPrefix, `Icon not found in message element for update:`, $messageElement.attr('mesid'));
        }
    }

    /**
     * Iterates through currently visible messages, injects the favorite icon if missing,
     * and updates its state based on stored data.
     */
    function injectOrUpdateFavoriteIcons() {
        const chatInfo = getCurrentChatInfo();
        if (!chatInfo) return; // No active chat

        const chatId = chatInfo.chatId;
        // console.log(logPrefix, "Updating icons for chat:", chatId);

        // Select all message blocks currently in the DOM
        $('#chat .mes').each(function() {
            const $messageElement = $(this);
            const $extraButtons = $messageElement.find('.extraMesButtons');
            let $iconContainer = $extraButtons.find(favIconSelector);

            // 1. Inject icon if it doesn't exist
            if ($extraButtons.length && $iconContainer.length === 0) {
                // Prepend is often better visually for button order
                $extraButtons.prepend(messageButtonHtml);
                $iconContainer = $extraButtons.find(favIconSelector); // Re-select after adding
                // console.log(logPrefix, 'Injected icon for message:', $messageElement.attr('mesid'));
            }

            // 2. Update state if icon container exists
            if ($iconContainer.length > 0) {
                const messageId = $messageElement.attr('mesid');
                if (messageId) {
                    const isFav = isFavorited(chatId, messageId);
                    updateFavoriteIconState($messageElement, isFav);
                } else {
                    // console.warn(logPrefix, "Message element missing mesid attribute:", $messageElement);
                }
            }
        });
        // console.log(logPrefix, "Icon update complete.");
    }


    // --- Event Handlers ---

    /**
     * Handles clicking the favorite icon on a message. Uses event delegation.
     * @param {Event} event - The click event object.
     */
    function handleFavoriteToggle(event) {
        const $iconContainer = $(event.target).closest(favIconSelector);
        if (!$iconContainer.length) return; // Click wasn't on the icon or its container

        const $messageElement = $iconContainer.closest('.mes');
        const messageId = $messageElement.attr('mesid');
        const chatInfo = getCurrentChatInfo();

        if (!messageId || !chatInfo) {
            console.error(logPrefix, "Could not get messageId or chatInfo on toggle.");
            alert("Error: Could not determine message or chat context.");
            return;
        }

        const chatId = chatInfo.chatId;
        const $icon = $iconContainer.find('i');

        // 1. Determine CURRENT state (visually)
        const isCurrentlyFavorited = $icon.hasClass(favoritedIconClass);

        // 2. Immediately toggle visual state
        updateFavoriteIconState($messageElement, !isCurrentlyFavorited);

        // 3. Call data function based on the NEW state
        if (!isCurrentlyFavorited) { // It WAS unfavorited, NEW state is favorited
            const message = getChatMessageById(messageId);
            if (message) {
                addFavorite(chatInfo, message);
            } else {
                console.error(logPrefix, `Could not find message object for ID ${messageId} to favorite.`);
                alert(`Error: Could not find message data for ID ${messageId}. Cannot favorite.`);
                // Revert visual state on error
                updateFavoriteIconState($messageElement, false);
            }
        } else { // It WAS favorited, NEW state is unfavorited
            removeFavoriteByMessageId(chatId, messageId);
        }
    }

    /**
     * Handles clicking the sidebar button to open the popup.
     */
    function openFavoritesPopup() {
        const chatInfo = getCurrentChatInfo();
        if (!chatInfo) {
            alert("Please open a chat first.");
            return;
        }
        const chatId = chatInfo.chatId;
        currentPopupChatId = chatId; // Track which chat we opened it for
        currentPopupPage = 1; // Reset to first page

        if (!favoritesPopup) {
            // Create popup instance only once
             const popupHtml = `
                <div class="favorites-popup-content">
                    <h4 id="favorites-popup-title">Favorites</h4>
                    <hr>
                    <div id="${popupListContainerId}" class="fav-list-container">
                        <div class="empty-state">Loading...</div>
                    </div>
                    <div id="${popupPaginationId}" class="pagination-controls" style="display: none;">
                        <button id="fav-popup-prev" class="menu_button fa-solid fa-arrow-left" title="Previous Page"></button>
                        <span id="fav-popup-page-indicator">Page 1 / 1</span>
                        <button id="fav-popup-next" class="menu_button fa-solid fa-arrow-right" title="Next Page"></button>
                    </div>
                    <hr>
                    <div class="popup_buttons">
                       <button id="fav-popup-clear-invalid" class="menu_button">Clear Invalid</button>
                       <button id="fav-popup-close" class="menu_button">Close</button>
                    </div>
                </div>
            `;
            favoritesPopup = new Popup(popupHtml, 'text', '', { okButton: 'none', cancelButton: 'none', wide: true, large: true });

             // Setup event delegation for popup content (attach to the popup's persistent element)
             $(favoritesPopup.dom).on('click', `#${popupListContainerId} .fa-pencil`, handleEditNote);
             $(favoritesPopup.dom).on('click', `#${popupListContainerId} .fa-trash`, handleDeleteFavoriteFromPopup);
             $(favoritesPopup.dom).on('click', '#fav-popup-prev', () => handlePopupPagination('prev'));
             $(favoritesPopup.dom).on('click', '#fav-popup-next', () => handlePopupPagination('next'));
             $(favoritesPopup.dom).on('click', '#fav-popup-clear-invalid', handleClearInvalidFavorites);
             $(favoritesPopup.dom).on('click', '#fav-popup-close', () => favoritesPopup.hide());

        }

        updateFavoritesPopup(chatId, currentPopupPage); // Populate content
        favoritesPopup.show();
    }

     /**
     * Renders the content of the favorites popup.
     * @param {string} chatId The chat ID to display favorites for.
     * @param {number} page The page number to display.
     */
    function updateFavoritesPopup(chatId, page = 1) {
        if (!favoritesPopup) return;

        currentPopupChatId = chatId; // Update tracked chat ID
        currentPopupPage = page;
        const settings = getPluginSettings();
        const chatData = settings.chats[chatId];
        const context = getContext();
        const isCurrentChat = getCurrentChatId() === chatId;

        let title = "Favorites";
        let favItems = [];
        let totalItems = 0;

        if (chatData) {
            title = `Favorites for: ${chatData.name || `Chat ${chatId}`} (${chatData.count})`;
            // Sort by timestamp ascending (oldest first)
            favItems = [...chatData.items].sort((a, b) => a.timestamp - b.timestamp);
            totalItems = chatData.count;
        } else {
            title = `Favorites for: Chat ${chatId} (0)`;
        }

        const $popupContent = $(favoritesPopup.dom).find('.favorites-popup-content');
        $popupContent.find('#favorites-popup-title').text(title);

        const $listContainer = $popupContent.find(`#${popupListContainerId}`);
        const $paginationControls = $popupContent.find(`#${popupPaginationId}`);
        const $pageIndicator = $popupContent.find('#fav-popup-page-indicator');
        const $prevButton = $popupContent.find('#fav-popup-prev');
        const $nextButton = $popupContent.find('#fav-popup-next');
        const $clearInvalidButton = $popupContent.find('#fav-popup-clear-invalid');

        if (totalItems === 0) {
            $listContainer.html('<div class="empty-state">No favorites in this chat yet.</div>');
            $paginationControls.hide();
            $clearInvalidButton.prop('disabled', true);
            return;
        }

        const totalPages = Math.ceil(totalItems / itemsPerPagePopup);
        page = Math.max(1, Math.min(page, totalPages)); // Clamp page number
        currentPopupPage = page; // Update global state

        const startIndex = (page - 1) * itemsPerPagePopup;
        const endIndex = startIndex + itemsPerPagePopup;
        const itemsToShow = favItems.slice(startIndex, endIndex);

        let listHtml = '';
        itemsToShow.forEach(favItem => {
            listHtml += renderFavoriteItem(favItem, isCurrentChat);
        });

        $listContainer.html(listHtml);

        // Update and show pagination
        $pageIndicator.text(`Page ${page} / ${totalPages}`);
        $prevButton.prop('disabled', page === 1);
        $nextButton.prop('disabled', page === totalPages);
        $paginationControls.show();

        // Enable/disable clear invalid button
        $clearInvalidButton.prop('disabled', !isCurrentChat);
        if (!isCurrentChat) {
             $clearInvalidButton.attr('title', 'Switch to this chat to clear invalid favorites.');
        } else {
             $clearInvalidButton.removeAttr('title');
        }

        // Scroll list to top after update
        $listContainer.scrollTop(0);
    }

    /**
     * Generates HTML for a single favorite item in the popup list.
     * @param {object} favItem The favorite item object from settings.
     * @param {boolean} isCurrentChat Whether the popup is for the currently active chat.
     * @returns {string} HTML string for the list item.
     */
    function renderFavoriteItem(favItem, isCurrentChat) {
        let previewText = '';
        let previewClass = '';
        const message = isCurrentChat ? getChatMessageById(favItem.messageId) : null;

        if (message) {
            previewText = (message.mes || '').substring(0, 80); // Increased preview length
            if (message.mes && message.mes.length > 80) previewText += '...';
             // Basic HTML entity escaping
             previewText = $('<div>').text(previewText).html();
        } else if (isCurrentChat) {
            previewText = "[Message deleted]";
            previewClass = 'deleted';
        } else {
             previewText = "[Preview requires switching to this chat]";
             previewClass = 'requires-switch';
        }


        const formattedTimestamp = favItem.timestamp ? timestampToMoment(favItem.timestamp).format("YYYY-MM-DD HH:mm:ss") : 'N/A';
        const noteDisplay = favItem.note ? `<div class="fav-note">Note: ${$('<div>').text(favItem.note).html()}</div>` : ''; // Escape note

        return `
            <div class="favorite-item" data-fav-id="${favItem.id}" data-msg-id="${favItem.messageId}">
              <div class="fav-meta">${$('<div>').text(favItem.sender).html()} (${favItem.role}) - ${formattedTimestamp}</div>
              ${noteDisplay}
              <div class="fav-preview ${previewClass}">${previewText}</div>
              <div class="fav-actions">
                <i class="fa-solid fa-pencil" title="Edit Note"></i>
                <i class="fa-solid fa-trash" title="Delete Favorite"></i>
              </div>
            </div>
        `;
    }

     /** Handles popup pagination clicks */
    function handlePopupPagination(direction) {
        if (!favoritesPopup || !currentPopupChatId) return;

        const settings = getPluginSettings();
        const chatData = settings.chats[currentPopupChatId];
        if (!chatData) return;

        const totalPages = Math.ceil(chatData.count / itemsPerPagePopup);

        if (direction === 'prev' && currentPopupPage > 1) {
            currentPopupPage--;
        } else if (direction === 'next' && currentPopupPage < totalPages) {
            currentPopupPage++;
        }
        updateFavoritesPopup(currentPopupChatId, currentPopupPage);
    }


    /** Handles click on the Edit Note icon in the popup */
    async function handleEditNote(event) {
         const $itemElement = $(event.target).closest('.favorite-item');
         const favId = $itemElement.data('fav-id');
         const chatId = currentPopupChatId; // Assumes popup is open

         if (!chatId || !favId) return;

         const settings = getPluginSettings();
         const chatData = settings.chats[chatId];
         const favItem = chatData?.items.find(item => item.id === favId);

         if (!favItem) {
             console.error(logPrefix, `Favorite item ${favId} not found for editing note.`);
             return;
         }

         try {
             const result = await callGenericPopup(
                 `Enter note for favorite (Sender: ${favItem.sender}):`,
                 POPUP_TYPE.INPUT,
                 favItem.note || '', // Default value is current note
                 { rows: 3 }
             );

             if (result !== null && result !== undefined) { // User confirmed (even if empty string)
                 favItem.note = result.trim();
                 console.log(logPrefix, `Updated note for favorite ${favId} in chat ${chatId}.`);
                 saveSettingsDebounced();
                 // Update just this item's display in the popup for efficiency
                 const $noteDisplay = $itemElement.find('.fav-note');
                 const escapedNote = $('<div>').text(favItem.note).html();
                  if (favItem.note) {
                      if ($noteDisplay.length) {
                          $noteDisplay.html(`Note: ${escapedNote}`).show();
                      } else {
                          // Add note element if it didn't exist
                          $itemElement.find('.fav-meta').after(`<div class="fav-note">Note: ${escapedNote}</div>`);
                      }
                  } else {
                      $noteDisplay.hide().empty(); // Hide if note is removed
                  }

                 // Also update plugin page if visible
                 renderPluginPage();
             }
         } catch (error) {
             console.error(logPrefix, "Error during edit note popup:", error);
         }
     }

     /** Handles click on the Delete icon in the popup */
     async function handleDeleteFavoriteFromPopup(event) {
         const $itemElement = $(event.target).closest('.favorite-item');
         const favId = $itemElement.data('fav-id');
         const messageId = $itemElement.data('msg-id'); // Get message ID for icon update
         const chatId = currentPopupChatId;

         if (!chatId || !favId) return;

         try {
             const confirmation = await callGenericPopup(
                 "Are you sure you want to remove this favorite entry?",
                 POPUP_TYPE.CONFIRM
             );

             if (confirmation) {
                 const removed = removeFavoriteById(chatId, favId); // This handles saving and popup refresh
                 if (removed) {
                     // Update the icon in the main chat interface if it's the current chat and message is visible
                     if (getCurrentChatId() === chatId) {
                         const $messageElement = $(`#chat .mes[mesid="${messageId}"]`);
                         if ($messageElement.length) {
                             updateFavoriteIconState($messageElement, false); // Set to unfavorited
                         }
                     }
                 }
             }
         } catch (error) {
             console.error(logPrefix, "Error during delete confirmation:", error);
             if (error !== POPUP_RESULT.CANCEL) { // Don't show alert if user just cancelled
                 alert("An error occurred while trying to delete the favorite.");
             }
         }
     }

     /** Handles click on the 'Clear Invalid' button in the popup */
    async function handleClearInvalidFavorites() {
        const chatId = currentPopupChatId;
        if (!chatId || getCurrentChatId() !== chatId) {
            alert("Please ensure you are in the correct chat to clear invalid favorites.");
            return;
        }

        const settings = getPluginSettings();
        const chatData = settings.chats[chatId];
        if (!chatData || !chatData.items || chatData.items.length === 0) {
            alert("No favorites to check in this chat.");
            return;
        }

        const context = getContext();
        const currentMessageIds = new Set(context.chat.map(msg => String(msg.id)));
        const invalidFavIds = [];

        chatData.items.forEach(favItem => {
            if (!currentMessageIds.has(String(favItem.messageId))) {
                invalidFavIds.push(favItem.id);
            }
        });

        if (invalidFavIds.length === 0) {
            alert("No invalid favorites found (all corresponding messages still exist).");
            return;
        }

        try {
            const confirmation = await callGenericPopup(
                `Found ${invalidFavIds.length} favorite(s) pointing to deleted messages. Remove them?`,
                POPUP_TYPE.CONFIRM
            );

            if (confirmation) {
                let removedCount = 0;
                invalidFavIds.forEach(favId => {
                    if (removeFavoriteById(chatId, favId)) { // removeFavoriteById handles saving and counts
                        removedCount++;
                    }
                });
                console.log(logPrefix, `Cleared ${removedCount} invalid favorites from chat ${chatId}.`);
                 // updateFavoritesPopup is called within removeFavoriteById, so no need to call again explicitly unless batching
                if(removedCount > 0) {
                    alert(`Removed ${removedCount} invalid favorite entries.`);
                    // Ensure the final state of the popup is rendered
                    updateFavoritesPopup(chatId, currentPopupPage);
                } else {
                     alert("No invalid favorites were removed (operation might have failed).");
                }
            }
        } catch (error) {
             console.error(logPrefix, "Error during clear invalid confirmation:", error);
             if (error !== POPUP_RESULT.CANCEL) {
                 alert("An error occurred while trying to clear invalid favorites.");
             }
        }
    }


    // --- Plugin Page (Settings Overview) Functions ---

    /** Renders the plugin's settings page content (overview of all favorites). */
    function renderPluginPage(page = 1) {
        const $settingsArea = $(`#${settingsContainerId}`);
        if (!$settingsArea.length) return; // Container not injected yet

        const settings = getPluginSettings();
        const allChats = settings.chats || {};
        const chatIds = Object.keys(allChats);

        if (chatIds.length === 0) {
            $settingsArea.html('<div class="empty-state">No favorites found across any chats yet.</div>');
            return;
        }

        // Group chats by character/group name for display
        const groupedChats = {};
        const context = getContext(); // Get context to try and find current names

        chatIds.forEach(chatId => {
            const chatData = allChats[chatId];
            let groupKey = "Unknown / Other";
            let displayName = chatData.name || `Chat ${chatId}`; // Use stored name first

            if (chatData.type === "private" && chatData.characterId) {
                const character = context.characters?.find(c => c.id === chatData.characterId);
                groupKey = character ? character.name : displayName; // Use current char name if found
            } else if (chatData.type === "group" && chatData.groupId) {
                const group = context.groups?.find(g => g.id === chatData.groupId);
                groupKey = group ? group.name : displayName; // Use current group name if found
            }

            if (!groupedChats[groupKey]) {
                groupedChats[groupKey] = [];
            }
            groupedChats[groupKey].push({
                chatId: chatId,
                displayName: displayName, // Display potentially old name if current not found
                count: chatData.count || 0,
            });
        });

        // Sort groups alphabetically, then chats within groups
        const sortedGroupKeys = Object.keys(groupedChats).sort((a, b) => a.localeCompare(b));

        let allEntries = [];
        sortedGroupKeys.forEach(groupKey => {
             // Add group title marker (or handle in render)
             allEntries.push({ isGroupTitle: true, title: groupKey });
            const sortedChats = groupedChats[groupKey].sort((a, b) => a.displayName.localeCompare(b.displayName));
             allEntries = allEntries.concat(sortedChats);
        });


        const totalEntries = allEntries.length; // Includes titles
        const totalPages = Math.ceil(totalEntries / itemsPerPagePluginPage);
        page = Math.max(1, Math.min(page, totalPages));
        currentPluginPagePage = page;

        const startIndex = (page - 1) * itemsPerPagePluginPage;
        const endIndex = startIndex + itemsPerPagePluginPage;
        const entriesToShow = allEntries.slice(startIndex, endIndex);

        let contentHtml = `<div id="${pluginPageListContainerId}" class="chat-list-container">`;
        entriesToShow.forEach(entry => {
            if (entry.isGroupTitle) {
                contentHtml += `<div class="chat-group-title">${$('<div>').text(entry.title).html()}</div>`;
            } else {
                contentHtml += `
                    <div class="chat-entry-item" data-chat-id="${entry.chatId}" title="Click to view favorites for ${$('<div>').text(entry.displayName).html()}">
                        <span>${$('<div>').text(entry.displayName).html()}</span>
                        <span class="count">(${entry.count})</span>
                    </div>`;
            }
        });
        contentHtml += `</div>`; // Close list container

        // Add pagination
        if (totalPages > 1) {
            contentHtml += `
                <div id="${pluginPagePaginationId}" class="pagination-controls">
                    <button id="fav-plugin-prev" class="menu_button fa-solid fa-arrow-left" title="Previous Page" ${page === 1 ? 'disabled' : ''}></button>
                    <span id="fav-plugin-page-indicator">Page ${page} / ${totalPages}</span>
                    <button id="fav-plugin-next" class="menu_button fa-solid fa-arrow-right" title="Next Page" ${page === totalPages ? 'disabled' : ''}></button>
                </div>`;
        }

        $settingsArea.html(contentHtml);
         // Ensure event delegation is active for the newly rendered content
        setupPluginPageEventDelegation(); // Re-run setup after render
    }

     /** Handles plugin page pagination clicks */
     function handlePluginPagePagination(direction) {
         const settings = getPluginSettings();
         const totalEntries = Object.keys(settings.chats || {}).length; // Rough count, adjust if titles counted
          if(totalEntries === 0) return; // No items, pagination shouldn't be visible anyway

          // Recalculate total pages based on how renderPluginPage groups/counts
          const chatIds = Object.keys(settings.chats || {});
          let entryCountForPaging = 0;
          const groupedChats = {};
           chatIds.forEach(chatId => {
               const chatData = settings.chats[chatId];
               let groupKey = "Unknown / Other";
                if (chatData.type === "private" && chatData.characterId) groupKey = chatData.name;
                else if (chatData.type === "group" && chatData.groupId) groupKey = chatData.name;
               if (!groupedChats[groupKey]) {
                   groupedChats[groupKey] = true;
                   entryCountForPaging++; // Count group title
               }
               entryCountForPaging++; // Count chat entry
           });

         const totalPages = Math.ceil(entryCountForPaging / itemsPerPagePluginPage);

         if (direction === 'prev' && currentPluginPagePage > 1) {
             currentPluginPagePage--;
         } else if (direction === 'next' && currentPluginPagePage < totalPages) {
             currentPluginPagePage++;
         }
         renderPluginPage(currentPluginPagePage);
     }


    /** Handles clicks on chat entries within the plugin settings page */
    function handlePluginPageChatClick(event) {
        const $chatEntry = $(event.target).closest('.chat-entry-item');
        if (!$chatEntry.length) return;

        const clickedChatId = $chatEntry.data('chat-id');
        if (clickedChatId) {
             console.log(logPrefix, `Opening favorites popup for chat ${clickedChatId} from plugin page.`);
            // Open the same popup, but pass the specific chatId
            currentPopupChatId = clickedChatId; // Set the target chat
            currentPopupPage = 1; // Reset page
             if(!favoritesPopup) {
                 openFavoritesPopup(); // Will create the popup if needed
             } else {
                updateFavoritesPopup(clickedChatId, currentPopupPage); // Update existing popup
                favoritesPopup.show();
             }
        }
    }

    /** Sets up event delegation for the plugin page list and pagination */
    function setupPluginPageEventDelegation() {
        const $settingsArea = $(`#${settingsContainerId}`);
        // Remove previous handlers to avoid duplicates if called multiple times
        $settingsArea.off('click', '.chat-entry-item');
        $settingsArea.off('click', '#fav-plugin-prev');
        $settingsArea.off('click', '#fav-plugin-next');

        // Add delegation
        $settingsArea.on('click', '.chat-entry-item', handlePluginPageChatClick);
        $settingsArea.on('click', '#fav-plugin-prev', () => handlePluginPagePagination('prev'));
        $settingsArea.on('click', '#fav-plugin-next', () => handlePluginPagePagination('next'));
    }


    // --- Plugin Initialization ---
    jQuery(async () => {
        console.log(logPrefix, "Loading...");
        initializeSettings();

        // 1. Inject into Extensions Page (Plugin Overview)
        try {
            const settingsHtml = await renderExtensionTemplateAsync(`third-party/${pluginFolderName}`, 'settings_display');
            // Using #extensions_settings as primary, fallback #translation_container
             let $container = $('#extensions_settings');
             if (!$container.length) {
                $container = $('#translation_container');
             }
             if($container.length) {
                $container.append(settingsHtml);
                console.log(logPrefix, `Added settings UI container to ${$container.attr('id')}`);
                renderPluginPage(currentPluginPagePage); // Initial render of the overview list
                setupPluginPageEventDelegation(); // Setup clicks for the list
             } else {
                 console.error(logPrefix, "Could not find container (#extensions_settings or #translation_container) for settings UI.");
             }
        } catch (error) {
            console.error(logPrefix, "Failed to load or inject settings_display.html:", error);
        }

        // 2. Inject Sidebar Button
        try {
            const sidebarButtonHtml = await renderExtensionTemplateAsync(`third-party/${pluginFolderName}`, 'sidebar_button');
            $('#data_bank_wand_container').append(sidebarButtonHtml);
            console.log(logPrefix, "Added sidebar button to #data_bank_wand_container");

            // Add direct click listener for the sidebar button
            $(document).on('click', `#${sidebarButtonId}`, openFavoritesPopup);

        } catch (error) {
            console.error(logPrefix, "Failed to load or inject sidebar_button.html:", error);
        }

        // 3. Setup Message Button Injection & Event Delegation
        injectOrUpdateFavoriteIcons(); // Initial injection for existing messages
        $(document).on('click', favIconSelector, handleFavoriteToggle); // Use event delegation for ALL icons
        console.log(logPrefix, `Set up event delegation for ${favIconSelector}`);


        // 4. Listen for SillyTavern events to keep icons updated
        eventSource.on(event_types.CHAT_UPDATED, injectOrUpdateFavoriteIcons);
        eventSource.on(event_types.CHARACTER_LOADED, injectOrUpdateFavoriteIcons);
        // Also update when settings are loaded/changed externally?
        // eventSource.on(event_types.SETTINGS_UPDATED, () => {
        //      injectOrUpdateFavoriteIcons();
        //      renderPluginPage(); // Refresh overview if settings change
        // });


        console.log(logPrefix, "Loaded successfully.");
    });

})(); // End IIFE