define(["OfflineUtils"], function(OfflineUtils){
    var GoogleAPIs = {};

    var clientId = window.configuration.google.clientId;
    var apiKey = window.configuration.google.apiKey;
    var scopes = "https://www.googleapis.com/auth/drive " +
        "https://www.googleapis.com/auth/drive.file " +
        "https://www.googleapis.com/auth/drive.metadata.readonly " +
        "https://www.googleapis.com/auth/drive.readonly " +
        "https://www.googleapis.com/auth/drive.install " +
        "https://www.googleapis.com/auth/userinfo.profile";

    var initialized = false;
    var authenticated = false;

    var fileCache = {};
    var fileCacheModifiedDate = {};

    GoogleAPIs.checkAuthentication = function(callback,errorCount,overlay){
        if (gapi == null){
            console.error("no gapi");
            if (OfflineUtils.enableGoogleOffline()){
                App.showModalMessage("Offline Mode","We were unable to load Google scripts, offline mode has been enabled!",function(){
                    callback(true);
                });
            }
            else{
                callback(false);
            }
            return;
        }

        if (errorCount == null) errorCount = 0;
        if (!initialized){
            if (gapi.client == null){
                if (errorCount >= 1500 && overlay == null){
                    overlay = App.createMessageOverlay($("body"),$("<span>We're having difficulties loading Google APIs. These are needed to login and play games.<br>If you have anti tracking software, it could be causing the issue and you should try disabling it for www.googulator.com and then <a href='javascript:void(0);' class='reloadLink'>reloading the app</a>.<br><a href='javascript:void(0);' class='dismissLink'>Click here to dismiss this popup</a></span>"));
                    overlay.find(".reloadLink").click(function(){
                        App.refreshPage();
                    });
                    overlay.find(".dismissLink").click(function(){
                        overlay.remove();
                    });

                }
                var that = this;
                setTimeout(function(){
                    that.checkAuthentication(callback,errorCount + 1, overlay);
                },1);
                return;
            }
            if (overlay != null)
                overlay.remove();
            gapi.client.setApiKey(apiKey);
            window.setTimeout(function(){
                gapi.auth.authorize({client_id: clientId, scope: scopes, immediate: true}, function (authResult) {
                    initialized = true;
                    authenticated = authResult != null && !authResult.error;
                    if (authenticated){
                        onAuthenticate(callback);
                    }
                    else
                        callback(authenticated)
                });
            },1);
        }
        else{
            callback(authenticated);
        }
    };

    GoogleAPIs.authenticate = function(callback){
        if (initialized){
            var returnVal = gapi.auth.authorize({client_id: clientId, scope: scopes, immediate: false}, function(authResult){
                authenticated = authResult != null && !authResult.error;
                if (authenticated){
                    onAuthenticate(callback);
                }
                else
                    callback(authenticated);
            });
            if (returnVal){
                if (typeof returnVal.screenX == "undefined" || returnVal.screenX == 0)
                    return false;
            }
            else{
                return false;
            }

            return true;
        }
        else{
            callback(authenticated);
        }
    };

    function onAuthenticate(callback){
        if (gapi.client.drive == null){
            gapi.client.load('drive', 'v2', function(){
                onAuthenticate(callback);
            });
            return;
        }
        if (gapi.client.oauth2 == null){
            gapi.client.load("oauth2", "v2", function(){
                onAuthenticate(callback);
            });
            return;
        }
        if (google.picker == null){
            gapi.load("picker", {callback:function(){onAuthenticate(callback)}});
            return;
        }
        $.doTimeout(gapi.auth.getToken().expires_in * 500,function(){
            if (!authenticated)
                return false;
            gapi.auth.authorize({client_id: clientId, scope: scopes, immediate: true},function(authResult){
                authenticated = authResult != null && !authResult.error;
            });
            return true;
        });
        callback(true);
    }

    GoogleAPIs.showFilePicker = function(callback,options){
        this.getUserInfo(function(userInfo){
            var multiSelect = true;
            var query = null;
            if (options != null){
                if (options.multiSelectDisabled != null)
                    multiSelect = options.multiSelect;
                query = options.query;
            }
            var view = new google.picker.View(google.picker.ViewId.DOCS);
            view.setMimeTypes("application/octet-stream");
            if (query != null)
                view.setQuery(query);
            var picker = new google.picker.PickerBuilder()
                //.enableFeature(google.picker.Feature.NAV_HIDDEN)
                .setAppId(clientId)
                .setDeveloperKey(apiKey)
                .setAuthUser(userInfo.id)
                .setOAuthToken(gapi.auth.getToken().access_token)
                .addView(view)
                .addView(new google.picker.View(google.picker.ViewId.FOLDERS))
                .addView(new google.picker.DocsUploadView().setIncludeFolders(true))
                .setCallback(function(data){
                    if (data.action == google.picker.Action.PICKED)
                        callback(data);
                    else if (data.action == google.picker.Action.CANCEL)
                        callback(null);
                });
            if (multiSelect)
                picker.enableFeature(google.picker.Feature.MULTISELECT_ENABLED);
            picker = picker.build();
            picker.setVisible(true);
        });
    }

    GoogleAPIs.getUserInfo = function(callback){
        if (App.googleUserInfo != null){
            callback(App.googleUserInfo);
            return;
        }
        else{
            this.refreshUserInfo(callback);
        }
    }

    GoogleAPIs.getAuthToken = function(){
        var token = gapi.auth.getToken();
        for (var member in token){
            if (typeof token[member] == "object")
                delete token[member];
        }
        return JSON.stringify(token);
    }

    GoogleAPIs.refreshUserInfo = function(callback){
        if (App.googleOffline){
            if (App.googleUserInfo == null){
                App.googleUserInfo = {};
                OfflineUtils.storeGoogleUserInfo();
            }
            this.getUserInfo(callback);
            return;
        }
        var that = this;
        gapi.client.oauth2.userinfo.get().execute(function(result){
            App.googleUserInfo = result;
            if (App.googleUserInfo == null)
                App.googleUserInfo = {};
            OfflineUtils.storeGoogleUserInfo();
            that.getUserInfo(callback);
        });
    }

    GoogleAPIs.uploadBinaryFile = function(filename, contents, callback, progresscallback){
        if (progresscallback == null) progresscallback = function(){};

        //TODO: handle if google is offline gracefully

        var boundary = '-------314159265358979323846';
        var delimiter = "\r\n--" + boundary + "\r\n";
        var close_delim = "\r\n--" + boundary + "--";

        var contentType = 'application/octet-stream';
        var metadata = {
            'title': filename,
            'mimeType': contentType
        };

        var base64Data = App.base64ArrayBuffer(contents);
        var multipartRequestBody =
            delimiter +
                'Content-Type: application/json\r\n\r\n' +
                JSON.stringify(metadata) +
                delimiter +
                'Content-Type: ' + contentType + '\r\n' +
                'Content-Transfer-Encoding: base64\r\n' +
                '\r\n' +
                base64Data +
                close_delim;

        var request = gapi.client.request({
            'path': '/upload/drive/v2/files',
            'method': 'POST',
            'params': {'uploadType': 'multipart'},
            'headers': {
                'Content-Type': 'multipart/mixed; boundary="' + boundary + '"'
            },
            'body': multipartRequestBody});
        request.execute(function(result,rawResponse){
            var response = JSON.parse(rawResponse);
            if (response.gapiRequest != null && response.gapiRequest.data.status == 200){
                fileCache[result.id] = contents;
                fileCacheModifiedDate[result.id] = new Date(result.modifiedDate);
                OfflineUtils.cacheGoogleDriveFile(result.id,contents,new Date(result.modifiedDate),function(success){
                    //should we do something if the local filesystem fails??
                    callback(result.id);
                });
            }
            else{
                setTimeout(function(){
                    GoogleAPIs.uploadBinaryFile(filename,contents,callback,progresscallback);
                },1000);//wait a second and try again
            }
        });
    }

    GoogleAPIs.updateBinaryFile = function(fileid,contents,callback,progresscallback){
        if (progresscallback == null) progresscallback = function(){};

        if (App.googleOffline){//if google is offline then we should just update the local file
            OfflineUtils.cacheGoogleDriveFile(fileid,contents,null,function(success){
                callback(success);
            });
            return;
        }


        var boundary = '-------314159265358979323846';
        var delimiter = "\r\n--" + boundary + "\r\n";
        var close_delim = "\r\n--" + boundary + "--";

        var contentType = 'application/octet-stream';
        var metadata = {
            'mimeType': contentType
        };
        // Updating the metadata is optional and you can instead use the value from drive.files.get.
        var base64Data = App.base64ArrayBuffer(contents);
        var multipartRequestBody =
            delimiter +
                'Content-Type: application/json\r\n\r\n' +
                JSON.stringify(metadata) +
                delimiter +
                'Content-Type: ' + contentType + '\r\n' +
                'Content-Transfer-Encoding: base64\r\n' +
                '\r\n' +
                base64Data +
                close_delim;

        var request = gapi.client.request({
            'path': '/upload/drive/v2/files/' + fileid,
            'method': 'PUT',
            'params': {'uploadType': 'multipart', 'alt': 'json'},
            'headers': {
                'Content-Type': 'multipart/mixed; boundary="' + boundary + '"'
            },
            'body': multipartRequestBody});
        request.execute(function(result,rawResponse){
            var response = JSON.parse(rawResponse);
            if (response.gapiRequest != null && response.gapiRequest.data.status == 200){
                fileCache[result.id] = contents;
                fileCacheModifiedDate[result.id] = new Date(result.modifiedDate);
                OfflineUtils.cacheGoogleDriveFile(fileid,contents,new Date(result.modifiedDate),function(success){
                    //should we do something if the local filesystem fails??
                    callback(true);
                });
            }
            else{
                setTimeout(function(){
                    GoogleAPIs.updateBinaryFile(fileid,contents,callback,progresscallback);
                },1000);//wait a second and try again
            }
        });

    }

    GoogleAPIs.hasFileInMemoryCache = function(fileid){
        return fileCache[fileid] != null;
    }

    GoogleAPIs.getFile = function(fileid,callback,progresscallback){
        if (progresscallback == null) progresscallback = function(){};
        progresscallback(0,100);



        if (fileCache[fileid] != null){
            OfflineUtils.googleDriveFileExists(fileid,function(exists){
                if (!exists){
                    OfflineUtils.cacheGoogleDriveFile(fileid,fileCache[fileid],fileCacheModifiedDate[fileid],function(success){
                        callback(fileCache[fileid]);
                    });
                }
                else{
                    callback(fileCache[fileid]);
                }
            });
            return;
        }

        if (App.googleOffline){//if google is offline our only hope is to get the file from the offline cache
            OfflineUtils.getGoogleDriveFileContents(fileid,function(data){
                if (data != null)
                    fileCache[fileid] = data;
                callback(data);
            });
            return;
        }

        gapi.client.drive.files.get({fileId:fileid,updateViewedDate:true}).execute(function(driveMetadata){
            OfflineUtils.getGoogleDriveFileMetadata(fileid,function(metadata){
                if (metadata == null || metadata.contentsModifiedDate.getTime() < new Date(driveMetadata.modifiedDate).getTime()){
                    App.downloadBinaryFile(driveMetadata.downloadUrl,{
                        accessToken: gapi.auth.getToken().access_token,
                        success: function(data){
                            fileCache[fileid] = data;
                            fileCacheModifiedDate[fileid] = new Date(driveMetadata.modifiedDate);
                            OfflineUtils.cacheGoogleDriveFile(fileid,data,new Date(driveMetadata.modifiedDate),function(){
                                callback(data);
                            });
                        },
                        error: function(){
                            callback(null);
                        },
                        onProgress:function(event){
                            progresscallback(event.loaded,event.total);
                        }
                    });
                }
                else{
                    OfflineUtils.getGoogleDriveFileContents(fileid,function(data){
                        if (data != null){
                            fileCache[fileid] = data;
                            fileCacheModifiedDate[fileid] = metadata.contentsModifiedDate;
                        }
                        callback(data);
                    });
                }
            });

        });
    }

    return GoogleAPIs;
});