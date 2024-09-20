import dataViewModel from "./models/DataViewModel.js"
import appStateModel from "./models/AppStateModel.js"
import finApiModel from "./models/FinApiModel.js"

if( !window.models ) window.models = {}
window.models.DataViewModel = dataViewModel;
window.models.AppStateModel = appStateModel;
window.models.FinApiModel = finApiModel;