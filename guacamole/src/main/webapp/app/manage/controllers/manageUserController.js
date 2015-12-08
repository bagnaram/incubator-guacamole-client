/*
 * Copyright (C) 2015 Glyptodon LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/**
 * The controller for editing users.
 */
angular.module('manage').controller('manageUserController', ['$scope', '$injector', 
        function manageUserController($scope, $injector) {
            
    // Required types
    var ConnectionGroup   = $injector.get('ConnectionGroup');
    var PageDefinition    = $injector.get('PageDefinition');
    var PermissionFlagSet = $injector.get('PermissionFlagSet');
    var PermissionSet     = $injector.get('PermissionSet');
    var User              = $injector.get('User');

    // Required services
    var $location                = $injector.get('$location');
    var $routeParams             = $injector.get('$routeParams');
    var authenticationService    = $injector.get('authenticationService');
    var connectionGroupService   = $injector.get('connectionGroupService');
    var dataSourceService        = $injector.get('dataSourceService');
    var guacNotification         = $injector.get('guacNotification');
    var permissionService        = $injector.get('permissionService');
    var schemaService            = $injector.get('schemaService');
    var translationStringService = $injector.get('translationStringService');
    var userService              = $injector.get('userService');

    /**
     * An action to be provided along with the object sent to showStatus which
     * closes the currently-shown status dialog.
     */
    var ACKNOWLEDGE_ACTION = {
        name        : "MANAGE_USER.ACTION_ACKNOWLEDGE",
        // Handle action
        callback    : function acknowledgeCallback() {
            guacNotification.showStatus(false);
        }
    };

    /**
     * The identifiers of all data sources currently available to the
     * authenticated user.
     *
     * @type String[]
     */
    var dataSources = authenticationService.getAvailableDataSources();

    /**
     * The username of the current, authenticated user.
     *
     * @type String
     */
    var currentUsername = authenticationService.getCurrentUsername();

    /**
     * The unique identifier of the data source containing the user being
     * edited.
     *
     * @type String
     */
    var selectedDataSource = $routeParams.dataSource;

    /**
     * The username of the user being edited. If a new user is
     * being created, this will not be defined.
     *
     * @type String
     */
    var username = $routeParams.id;

    /**
     * All user accounts associated with the same username as the account being
     * created or edited, as a map of data source identifier to the User object
     * within that data source.
     *
     * @type Object.<String, User>
     */
    $scope.users = null;

    /**
     * The user being modified.
     *
     * @type User
     */
    $scope.user = null;

    /**
     * All permissions associated with the user being modified.
     * 
     * @type PermissionFlagSet
     */
    $scope.permissionFlags = null;

    /**
     * A map of data source identifiers to the root connection groups within
     * thost data sources. As only one data source is applicable to any one
     * user being edited/created, this will only contain a single key.
     *
     * @type Object.<String, ConnectionGroup>
     */
    $scope.rootGroups = null;
    
    /**
     * A map of data source identifiers to the set of all permissions
     * associated with the current user under that data source, or null if the
     * user's permissions have not yet been loaded.
     *
     * @type Object.<String, PermissionSet>
     */
    $scope.permissions = null;

    /**
     * All available user attributes. This is only the set of attribute
     * definitions, organized as logical groupings of attributes, not attribute
     * values.
     *
     * @type Form[]
     */
    $scope.attributes = null;

    /**
     * The pages associated with each user account having the given username.
     * Each user account will be associated with a particular data source.
     *
     * @type PageDefinition[]
     */
    $scope.accountPages = [];

    /**
     * Returns whether critical data has completed being loaded.
     *
     * @returns {Boolean}
     *     true if enough data has been loaded for the user interface to be
     *     useful, false otherwise.
     */
    $scope.isLoaded = function isLoaded() {

        return $scope.users               !== null
            && $scope.permissionFlags     !== null
            && $scope.rootGroups          !== null
            && $scope.permissions         !== null
            && $scope.attributes          !== null;

    };

    /**
     * Returns whether the user being edited already exists within the data
     * source specified.
     *
     * @param {String} [dataSource]
     *     The identifier of the data source to check. If omitted, this will
     *     default to the currently-selected data source.
     *
     * @returns {Boolean}
     *     true if the user being edited already exists, false otherwise.
     */
    $scope.userExists = function userExists(dataSource) {

        // Do not check if users are not yet loaded
        if (!$scope.users)
            return false;

        // Use currently-selected data source if unspecified
        dataSource = dataSource || selectedDataSource;

        // Account exists only if it was successfully retrieved
        return (dataSource in $scope.users);

    };

    /**
     * Returns whether the current user can change attributes associated with
     * the user being edited within the given data source.
     *
     * @param {String} [dataSource]
     *     The identifier of the data source to check. If omitted, this will
     *     default to the currently-selected data source.
     *
     * @returns {Boolean}
     *     true if the current user can change attributes associated with the
     *     user being edited, false otherwise.
     */
    $scope.canChangeAttributes = function canChangeAttributes(dataSource) {

        // Do not check if permissions are not yet loaded
        if (!$scope.permissions)
            return false;

        // Use currently-selected data source if unspecified
        dataSource = dataSource || selectedDataSource;

        // Attributes can always be set if we are creating the user
        if (!$scope.userExists(dataSource))
            return true;

        // The administrator can always change attributes
        if (PermissionSet.hasSystemPermission($scope.permissions[dataSource],
                PermissionSet.SystemPermissionType.ADMINISTER))
            return true;

        // Otherwise, can change attributes if we have permission to update this user
        return PermissionSet.hasUserPermission($scope.permissions[dataSource],
            PermissionSet.ObjectPermissionType.UPDATE, username);

    };

    /**
     * Returns whether the current user can change permissions of any kind
     * which are associated with the user being edited within the given data
     * source.
     *
     * @param {String} [dataSource]
     *     The identifier of the data source to check. If omitted, this will
     *     default to the currently-selected data source.
     *
     * @returns {Boolean}
     *     true if the current user can grant or revoke permissions of any kind
     *     which are associated with the user being edited, false otherwise.
     */
    $scope.canChangePermissions = function canChangePermissions(dataSource) {

        // Do not check if permissions are not yet loaded
        if (!$scope.permissions)
            return false;

        // Use currently-selected data source if unspecified
        dataSource = dataSource || selectedDataSource;

        // Permissions can always be set if we are creating the user
        if (!$scope.userExists(dataSource))
            return true;

        // The administrator can always modify permissions
        if (PermissionSet.hasSystemPermission($scope.permissions[dataSource],
                PermissionSet.SystemPermissionType.ADMINISTER))
            return true;

        // Otherwise, can only modify permissions if we have explicit
        // ADMINISTER permission
        return PermissionSet.hasUserPermission($scope.permissions[dataSource],
            PermissionSet.ObjectPermissionType.ADMINISTER, username);

    };

    /**
     * Returns whether the current user can change the system permissions
     * granted to the user being edited within the given data source.
     *
     * @param {String} [dataSource]
     *     The identifier of the data source to check. If omitted, this will
     *     default to the currently-selected data source.
     *
     * @returns {Boolean}
     *     true if the current user can grant or revoke system permissions to
     *     the user being edited, false otherwise.
     */
    $scope.canChangeSystemPermissions = function canChangeSystemPermissions(dataSource) {

        // Do not check if permissions are not yet loaded
        if (!$scope.permissions)
            return false;

        // Use currently-selected data source if unspecified
        dataSource = dataSource || selectedDataSource;

        // Only the administrator can modify system permissions
        return PermissionSet.hasSystemPermission($scope.permissions[dataSource],
            PermissionSet.SystemPermissionType.ADMINISTER);

    };

    /**
     * Returns whether the current user can edit the username of the user being
     * edited within the given data source.
     *
     * @param {String} [dataSource]
     *     The identifier of the data source to check. If omitted, this will
     *     default to the currently-selected data source.
     *
     * @returns {Boolean}
     *     true if the current user can edit the username of the user being
     *     edited, false otherwise.
     */
    $scope.canEditUsername = function canEditUsername(dataSource) {
        return !username;
    };

    /**
     * Returns whether the current user can save the user being edited within
     * the given data source. Saving will create or update that user depending
     * on whether the user already exists.
     *
     * @param {String} [dataSource]
     *     The identifier of the data source to check. If omitted, this will
     *     default to the currently-selected data source.
     *
     * @returns {Boolean}
     *     true if the current user can save changes to the user being edited,
     *     false otherwise.
     */
    $scope.canSaveUser = function canSaveUser(dataSource) {

        // Do not check if permissions are not yet loaded
        if (!$scope.permissions)
            return false;

        // Use currently-selected data source if unspecified
        dataSource = dataSource || selectedDataSource;

        // The administrator can always save users
        if (PermissionSet.hasSystemPermission($scope.permissions[dataSource],
                PermissionSet.SystemPermissionType.ADMINISTER))
            return true;

        // If user does not exist, can only save if we have permission to create users
        if (!$scope.userExists(dataSource))
           return PermissionSet.hasSystemPermission($scope.permissions[dataSource],
               PermissionSet.SystemPermissionType.CREATE_USER);

        // Otherwise, can only save if we have permission to update this user
        return PermissionSet.hasUserPermission($scope.permissions[dataSource],
            PermissionSet.ObjectPermissionType.UPDATE, username);

    };

    /**
     * Returns whether the current user can delete the user being edited from
     * the given data source.
     *
     * @param {String} [dataSource]
     *     The identifier of the data source to check. If omitted, this will
     *     default to the currently-selected data source.
     *
     * @returns {Boolean}
     *     true if the current user can delete the user being edited, false
     *     otherwise.
     */
    $scope.canDeleteUser = function canDeleteUser(dataSource) {

        // Do not check if permissions are not yet loaded
        if (!$scope.permissions)
            return false;

        // Use currently-selected data source if unspecified
        dataSource = dataSource || selectedDataSource;

        // Can't delete what doesn't exist
        if (!$scope.userExists(dataSource))
            return false;

        // The administrator can always delete users
        if (PermissionSet.hasSystemPermission($scope.permissions[dataSource],
                PermissionSet.SystemPermissionType.ADMINISTER))
            return true;

        // Otherwise, require explicit DELETE permission on the user
        return PermissionSet.hasUserPermission($scope.permissions[dataSource],
            PermissionSet.ObjectPermissionType.DELETE, username);

    };

    /**
     * Returns whether the user being edited within the given data source is
     * read-only, and thus cannot be modified by the current user.
     *
     * @param {String} [dataSource]
     *     The identifier of the data source to check. If omitted, this will
     *     default to the currently-selected data source.
     *
     * @returns {Boolean}
     *     true if the user being edited is actually read-only and cannot be
     *     edited at all, false otherwise.
     */
    $scope.isReadOnly = function isReadOnly(dataSource) {

        // Use currently-selected data source if unspecified
        dataSource = dataSource || selectedDataSource;

        // User is read-only if they cannot be saved
        return !$scope.canSaveUser(dataSource);

    };

    // Update visible account pages whenever available users/permissions changes
    $scope.$watchGroup(['users', 'permissions'], function updateAccountPages() {

        // Generate pages for each applicable data source
        $scope.accountPages = [];
        angular.forEach(dataSources, function addAccountPage(dataSource) {

            // Determine whether data source contains this user
            var linked   = $scope.userExists(dataSource);
            var readOnly = $scope.isReadOnly(dataSource);

            // Account is not relevant if it does not exist and cannot be
            // created
            if (!linked && readOnly)
                return;

            // Determine class name based on read-only / linked status
            var className;
            if (readOnly)    className = 'read-only';
            else if (linked) className = 'linked';
            else             className = 'unlinked';

            // Add page entry
            $scope.accountPages.push(new PageDefinition({
                name      : translationStringService.canonicalize('DATA_SOURCE_' + dataSource) + '.NAME',
                url       : '/manage/' + encodeURIComponent(dataSource) + '/users/' + encodeURIComponent(username),
                className : className
            }));

        });

    });

    // Pull user attribute schema
    schemaService.getUserAttributes(selectedDataSource).success(function attributesReceived(attributes) {
        $scope.attributes = attributes;
    });

    // Pull user data and permissions if we are editing an existing user
    if (username) {

        // Pull user data
        dataSourceService.apply(userService.getUser, dataSources, username)
        .then(function usersReceived(users) {

            // Get user for currently-selected data source
            $scope.users = users;
            $scope.user  = users[selectedDataSource];

            // Create skeleton user if user does not exist
            if (!$scope.user)
                $scope.user = new User({
                    'username' : username
                });

        });

        // Pull user permissions
        permissionService.getPermissions(selectedDataSource, username).success(function gotPermissions(permissions) {
            $scope.permissionFlags = PermissionFlagSet.fromPermissionSet(permissions);
        })

        // If permissions cannot be retrieved, use empty permissions
        .error(function permissionRetrievalFailed() {
            $scope.permissionFlags = new PermissionFlagSet();
        });
    }

    // Use skeleton data if we are creating a new user
    else {

        // No users exist regardless of data source if there is no username
        $scope.users = {};

        // Use skeleton user object with no associated permissions
        $scope.user = new User();
        $scope.permissionFlags = new PermissionFlagSet();

    }

    // Retrieve all connections for which we have ADMINISTER permission
    dataSourceService.apply(
        connectionGroupService.getConnectionGroupTree,
        [selectedDataSource],
        ConnectionGroup.ROOT_IDENTIFIER,
        [PermissionSet.ObjectPermissionType.ADMINISTER]
    )
    .then(function connectionGroupReceived(rootGroups) {
        $scope.rootGroups = rootGroups;
    });
    
    // Query the user's permissions for the current user
    dataSourceService.apply(
        permissionService.getPermissions,
        dataSources,
        currentUsername
    )
    .then(function permissionsReceived(permissions) {
        $scope.permissions = permissions;
    });

    /**
     * Available system permission types, as translation string / internal
     * value pairs.
     * 
     * @type Object[]
     */
    $scope.systemPermissionTypes = [
        {
            label: "MANAGE_USER.FIELD_HEADER_ADMINISTER_SYSTEM",
            value: PermissionSet.SystemPermissionType.ADMINISTER
        },
        {
            label: "MANAGE_USER.FIELD_HEADER_CREATE_NEW_USERS",
            value: PermissionSet.SystemPermissionType.CREATE_USER
        },
        {
            label: "MANAGE_USER.FIELD_HEADER_CREATE_NEW_CONNECTIONS",
            value: PermissionSet.SystemPermissionType.CREATE_CONNECTION
        },
        {
            label: "MANAGE_USER.FIELD_HEADER_CREATE_NEW_CONNECTION_GROUPS",
            value: PermissionSet.SystemPermissionType.CREATE_CONNECTION_GROUP
        }
    ];

    /**
     * The set of permissions that will be added to the user when the user is
     * saved. Permissions will only be present in this set if they are
     * manually added, and not later manually removed before saving.
     *
     * @type PermissionSet
     */
    var permissionsAdded = new PermissionSet();

    /**
     * The set of permissions that will be removed from the user when the user 
     * is saved. Permissions will only be present in this set if they are
     * manually removed, and not later manually added before saving.
     *
     * @type PermissionSet
     */
    var permissionsRemoved = new PermissionSet();

    /**
     * Updates the permissionsAdded and permissionsRemoved permission sets to
     * reflect the addition of the given system permission.
     * 
     * @param {String} type
     *     The system permission to add, as defined by
     *     PermissionSet.SystemPermissionType.
     */
    var addSystemPermission = function addSystemPermission(type) {

        // If permission was previously removed, simply un-remove it
        if (PermissionSet.hasSystemPermission(permissionsRemoved, type))
            PermissionSet.removeSystemPermission(permissionsRemoved, type);

        // Otherwise, explicitly add the permission
        else
            PermissionSet.addSystemPermission(permissionsAdded, type);

    };

    /**
     * Updates the permissionsAdded and permissionsRemoved permission sets to
     * reflect the removal of the given system permission.
     *
     * @param {String} type
     *     The system permission to remove, as defined by
     *     PermissionSet.SystemPermissionType.
     */
    var removeSystemPermission = function removeSystemPermission(type) {

        // If permission was previously added, simply un-add it
        if (PermissionSet.hasSystemPermission(permissionsAdded, type))
            PermissionSet.removeSystemPermission(permissionsAdded, type);

        // Otherwise, explicitly remove the permission
        else
            PermissionSet.addSystemPermission(permissionsRemoved, type);

    };

    /**
     * Notifies the controller that a change has been made to the given
     * system permission for the user being edited.
     *
     * @param {String} type
     *     The system permission that was changed, as defined by
     *     PermissionSet.SystemPermissionType.
     */
    $scope.systemPermissionChanged = function systemPermissionChanged(type) {

        // Determine current permission setting
        var value = $scope.permissionFlags.systemPermissions[type];

        // Add/remove permission depending on flag state
        if (value)
            addSystemPermission(type);
        else
            removeSystemPermission(type);

    };

    /**
     * Updates the permissionsAdded and permissionsRemoved permission sets to
     * reflect the addition of the given user permission.
     * 
     * @param {String} type
     *     The user permission to add, as defined by
     *     PermissionSet.ObjectPermissionType.
     *
     * @param {String} identifier
     *     The identifier of the user affected by the permission being added.
     */
    var addUserPermission = function addUserPermission(type, identifier) {

        // If permission was previously removed, simply un-remove it
        if (PermissionSet.hasUserPermission(permissionsRemoved, type, identifier))
            PermissionSet.removeUserPermission(permissionsRemoved, type, identifier);

        // Otherwise, explicitly add the permission
        else
            PermissionSet.addUserPermission(permissionsAdded, type, identifier);

    };

    /**
     * Updates the permissionsAdded and permissionsRemoved permission sets to
     * reflect the removal of the given user permission.
     *
     * @param {String} type
     *     The user permission to remove, as defined by
     *     PermissionSet.ObjectPermissionType.
     *
     * @param {String} identifier
     *     The identifier of the user affected by the permission being removed.
     */
    var removeUserPermission = function removeUserPermission(type, identifier) {

        // If permission was previously added, simply un-add it
        if (PermissionSet.hasUserPermission(permissionsAdded, type, identifier))
            PermissionSet.removeUserPermission(permissionsAdded, type, identifier);

        // Otherwise, explicitly remove the permission
        else
            PermissionSet.addUserPermission(permissionsRemoved, type, identifier);

    };

    /**
     * Notifies the controller that a change has been made to the given user
     * permission for the user being edited.
     *
     * @param {String} type
     *     The user permission that was changed, as defined by
     *     PermissionSet.ObjectPermissionType.
     *
     * @param {String} identifier
     *     The identifier of the user affected by the changed permission.
     */
    $scope.userPermissionChanged = function userPermissionChanged(type, identifier) {

        // Determine current permission setting
        var value = $scope.permissionFlags.userPermissions[type][identifier];

        // Add/remove permission depending on flag state
        if (value)
            addUserPermission(type, identifier);
        else
            removeUserPermission(type, identifier);

    };

    /**
     * Updates the permissionsAdded and permissionsRemoved permission sets to
     * reflect the addition of the given connection permission.
     * 
     * @param {String} identifier
     *     The identifier of the connection to add READ permission for.
     */
    var addConnectionPermission = function addConnectionPermission(identifier) {

        // If permission was previously removed, simply un-remove it
        if (PermissionSet.hasConnectionPermission(permissionsRemoved, PermissionSet.ObjectPermissionType.READ, identifier))
            PermissionSet.removeConnectionPermission(permissionsRemoved, PermissionSet.ObjectPermissionType.READ, identifier);

        // Otherwise, explicitly add the permission
        else
            PermissionSet.addConnectionPermission(permissionsAdded, PermissionSet.ObjectPermissionType.READ, identifier);

    };

    /**
     * Updates the permissionsAdded and permissionsRemoved permission sets to
     * reflect the removal of the given connection permission.
     *
     * @param {String} identifier
     *     The identifier of the connection to remove READ permission for.
     */
    var removeConnectionPermission = function removeConnectionPermission(identifier) {

        // If permission was previously added, simply un-add it
        if (PermissionSet.hasConnectionPermission(permissionsAdded, PermissionSet.ObjectPermissionType.READ, identifier))
            PermissionSet.removeConnectionPermission(permissionsAdded, PermissionSet.ObjectPermissionType.READ, identifier);

        // Otherwise, explicitly remove the permission
        else
            PermissionSet.addConnectionPermission(permissionsRemoved, PermissionSet.ObjectPermissionType.READ, identifier);

    };

    /**
     * Updates the permissionsAdded and permissionsRemoved permission sets to
     * reflect the addition of the given connection group permission.
     * 
     * @param {String} identifier
     *     The identifier of the connection group to add READ permission for.
     */
    var addConnectionGroupPermission = function addConnectionGroupPermission(identifier) {

        // If permission was previously removed, simply un-remove it
        if (PermissionSet.hasConnectionGroupPermission(permissionsRemoved, PermissionSet.ObjectPermissionType.READ, identifier))
            PermissionSet.removeConnectionGroupPermission(permissionsRemoved, PermissionSet.ObjectPermissionType.READ, identifier);

        // Otherwise, explicitly add the permission
        else
            PermissionSet.addConnectionGroupPermission(permissionsAdded, PermissionSet.ObjectPermissionType.READ, identifier);

    };

    /**
     * Updates the permissionsAdded and permissionsRemoved permission sets to
     * reflect the removal of the given connection permission.
     *
     * @param {String} identifier
     *     The identifier of the connection to remove READ permission for.
     */
    var removeConnectionGroupPermission = function removeConnectionGroupPermission(identifier) {

        // If permission was previously added, simply un-add it
        if (PermissionSet.hasConnectionGroupPermission(permissionsAdded, PermissionSet.ObjectPermissionType.READ, identifier))
            PermissionSet.removeConnectionGroupPermission(permissionsAdded, PermissionSet.ObjectPermissionType.READ, identifier);

        // Otherwise, explicitly remove the permission
        else
            PermissionSet.addConnectionGroupPermission(permissionsRemoved, PermissionSet.ObjectPermissionType.READ, identifier);

    };

    // Expose permission query and modification functions to group list template
    $scope.groupListContext = {

        /**
         * Returns the PermissionFlagSet that contains the current state of
         * granted permissions.
         *
         * @returns {PermissionFlagSet}
         *     The PermissionFlagSet describing the current state of granted
         *     permissions for the user being edited.
         */
        getPermissionFlags : function getPermissionFlags() {
            return $scope.permissionFlags;
        },

        /**
         * Notifies the controller that a change has been made to the given
         * connection permission for the user being edited. This only applies
         * to READ permissions.
         *
         * @param {String} identifier
         *     The identifier of the connection affected by the changed
         *     permission.
         */
        connectionPermissionChanged : function connectionPermissionChanged(identifier) {

            // Determine current permission setting
            var value = $scope.permissionFlags.connectionPermissions.READ[identifier];

            // Add/remove permission depending on flag state
            if (value)
                addConnectionPermission(identifier);
            else
                removeConnectionPermission(identifier);

        },

        /**
         * Notifies the controller that a change has been made to the given
         * connection group permission for the user being edited. This only
         * applies to READ permissions.
         *
         * @param {String} identifier
         *     The identifier of the connection group affected by the changed
         *     permission.
         */
        connectionGroupPermissionChanged : function connectionGroupPermissionChanged(identifier) {

            // Determine current permission setting
            var value = $scope.permissionFlags.connectionGroupPermissions.READ[identifier];

            // Add/remove permission depending on flag state
            if (value)
                addConnectionGroupPermission(identifier);
            else
                removeConnectionGroupPermission(identifier);

        }

    };

    /**
     * Cancels all pending edits, returning to the management page.
     */
    $scope.cancel = function cancel() {
        $location.path('/settings/users');
    };
            
    /**
     * Saves the user, updating the existing user only.
     */
    $scope.saveUser = function saveUser() {

        // Verify passwords match
        if ($scope.passwordMatch !== $scope.user.password) {
            guacNotification.showStatus({
                'className'  : 'error',
                'title'      : 'MANAGE_USER.DIALOG_HEADER_ERROR',
                'text'       : 'MANAGE_USER.ERROR_PASSWORD_MISMATCH',
                'actions'    : [ ACKNOWLEDGE_ACTION ]
            });
            return;
        }

        // Save or create the user, depending on whether the user exists
        var saveUserPromise;
        if ($scope.userExists(selectedDataSource))
            saveUserPromise = userService.saveUser(selectedDataSource, $scope.user);
        else
            saveUserPromise = userService.createUser(selectedDataSource, $scope.user);

        saveUserPromise.success(function savedUser() {

            // Upon success, save any changed permissions
            permissionService.patchPermissions(selectedDataSource, $scope.user.username, permissionsAdded, permissionsRemoved)
            .success(function patchedUserPermissions() {
                $location.path('/settings/users');
            })

            // Notify of any errors
            .error(function userPermissionsPatchFailed(error) {
                guacNotification.showStatus({
                    'className'  : 'error',
                    'title'      : 'MANAGE_USER.DIALOG_HEADER_ERROR',
                    'text'       : error.message,
                    'actions'    : [ ACKNOWLEDGE_ACTION ]
                });
            });

        })

        // Notify of any errors
        .error(function userSaveFailed(error) {
            guacNotification.showStatus({
                'className'  : 'error',
                'title'      : 'MANAGE_USER.DIALOG_HEADER_ERROR',
                'text'       : error.message,
                'actions'    : [ ACKNOWLEDGE_ACTION ]
            });
        });

    };
    
    /**
     * An action to be provided along with the object sent to showStatus which
     * immediately deletes the current user.
     */
    var DELETE_ACTION = {
        name        : "MANAGE_USER.ACTION_DELETE",
        className   : "danger",
        // Handle action
        callback    : function deleteCallback() {
            deleteUserImmediately();
            guacNotification.showStatus(false);
        }
    };

    /**
     * An action to be provided along with the object sent to showStatus which
     * closes the currently-shown status dialog.
     */
    var CANCEL_ACTION = {
        name        : "MANAGE_USER.ACTION_CANCEL",
        // Handle action
        callback    : function cancelCallback() {
            guacNotification.showStatus(false);
        }
    };

    /**
     * Immediately deletes the current user, without prompting the user for
     * confirmation.
     */
    var deleteUserImmediately = function deleteUserImmediately() {

        // Delete the user 
        userService.deleteUser(selectedDataSource, $scope.user)
        .success(function deletedUser() {
            $location.path('/settings/users');
        })

        // Notify of any errors
        .error(function userDeletionFailed(error) {
            guacNotification.showStatus({
                'className'  : 'error',
                'title'      : 'MANAGE_USER.DIALOG_HEADER_ERROR',
                'text'       : error.message,
                'actions'    : [ ACKNOWLEDGE_ACTION ]
            });
        });

    };

    /**
     * Deletes the user, prompting the user first to confirm that deletion is
     * desired.
     */
    $scope.deleteUser = function deleteUser() {

        // Confirm deletion request
        guacNotification.showStatus({
            'title'      : 'MANAGE_USER.DIALOG_HEADER_CONFIRM_DELETE',
            'text'       : 'MANAGE_USER.TEXT_CONFIRM_DELETE',
            'actions'    : [ DELETE_ACTION, CANCEL_ACTION]
        });

    };

}]);
